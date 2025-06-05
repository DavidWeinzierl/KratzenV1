import { GameState, GameRules, Card, Deck } from './gameLogic.js';
import { aiDecideBid, aiDecideExchange, aiDecideCardToPlay, aiDecideCardToDiscard } from './aiPlayer.js';
import { renderGame, animateCardMovement, getElementCoordinates } from './uiRenderer.js';
import { logMessage } from './logger.js';
import { PLAYER_STATUS, GAME_PHASE, BID_OPTIONS, EXCHANGE_TYPE, WELI_RANK, RANKS } from './constants.js';

let gameState = null;
const PLAYER_COUNT = 4;
export let isManualBiddingMode = false; // Global flag for P0 manual play on all relevant actions

let currentDealerAnte = 1.0;
let currentMuasPenalty = 1.0;
let currentAnimationSpeed = 0.5;

const defaultStrategy = {
    bidStage1: { minCompanionTrumpValueForSneak: "X", soloTrumpAceSneakChance: 0.3, minTrumpForOderMit: "9", alwaysSneakIfLastAndNoBid: true },
    bidStage2: { minTrumpValueToPlayWithSneaker: "9", lowTrumpPlayChanceWithSneaker: 0.3, minSuitValueForOderPlay: "U", playIfLastNoOneJoined: true },
    exchange: { maxTrumpValueForTrumpfPackerl: "9", considerSauIfPlanned: true }
};

let player1StrategyConfig = JSON.parse(JSON.stringify(defaultStrategy));
let otherPlayersStrategyConfig = JSON.parse(JSON.stringify(defaultStrategy));

export let isSimulationRunning = false;
export let areOtherPlayersCardsHidden = false;

// NEW: State for P0 manual card selection (exported for uiRenderer to read for highlighting)
export let selectedCardsForManualAction = [];

// --- Helper Functions (Should be at the top level of the module) ---
function getActivePlayerOrder(gs) {
    const active = gs.getActivePlayers();
    if (!active || active.length === 0) return [];
    const forehandIndex = gs.nextPlayerIndex(gs.dealerIndex);
    active.sort((a, b) => {
        const orderA = (a.id - forehandIndex + gs.players.length) % gs.players.length;
        const orderB = (b.id - forehandIndex + gs.players.length) % gs.players.length;
        return orderA - orderB;
    });
    return active;
}

async function replenishTalonIfNeeded() {
    let gs = gameState;
    if (gs.talon.length === 0) {
        let cardsForNewTalon = [];
        if (gs.discardPile && gs.discardPile.length > 0) { cardsForNewTalon.push(...gs.discardPile.filter(c => c instanceof Card)); gs.discardPile = []; }
        if (gs.foldedPile && gs.foldedPile.length > 0) { cardsForNewTalon.push(...gs.foldedPile.filter(c => c instanceof Card)); gs.foldedPile = []; }
        if (cardsForNewTalon.length > 0) {
            gs.talon = cardsForNewTalon;
            for (let k = gs.talon.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [gs.talon[k], gs.talon[j]] = [gs.talon[j], gs.talon[k]]; }
            if (!isSimulationRunning) logMessage(`Talon replenished and reshuffled. New Talon size: ${gs.talon.length}`);
            return true;
        } else { if (!isSimulationRunning) logMessage("Talon empty. Discard/folded piles also empty. Cannot replenish."); return false; }
    }
    return true;
}

export function setDealerAnte(value) { currentDealerAnte = parseFloat(value); if(!isNaN(currentDealerAnte)) logMessage(`Dealer Ante: ${currentDealerAnte.toFixed(1)}`); else console.warn("Invalid Dealer Ante value:", value);}
export function setMuasPenalty(value) { currentMuasPenalty = parseFloat(value); if(!isNaN(currentMuasPenalty)) logMessage(`"Muas" Penalty: ${currentMuasPenalty.toFixed(1)}`);  else console.warn("Invalid Muas Penalty value:", value);}

export function updateStrategyParameter(targetGroup, category, parameterName, value) {
    let configToUpdate = (targetGroup === 'player1') ? player1StrategyConfig : otherPlayersStrategyConfig;
    if (!configToUpdate[category]) configToUpdate[category] = {};
    const numVal = parseFloat(value);
    configToUpdate[category][parameterName] = (!isNaN(numVal) && !RANKS.includes(String(value).toUpperCase()) && typeof value !== 'boolean') ? numVal : value;
    logMessage(`Strategy (${targetGroup === 'player1' ? 'P0' : 'Others'}): ${category}.${parameterName} = ${configToUpdate[category][parameterName]}`);
}
export function setAnimationSpeed(speed) { currentAnimationSpeed = parseFloat(speed); if(!isNaN(currentAnimationSpeed)) logMessage(`Animation speed set to: ${currentAnimationSpeed.toFixed(1)}s`); else console.warn("Invalid Animation Speed value:", speed); }

export function toggleOtherPlayersCardVisibility() {
    areOtherPlayersCardsHidden = !areOtherPlayersCardsHidden;
    if (!isSimulationRunning) {
        logMessage(`Other players' cards are now ${areOtherPlayersCardsHidden ? 'hidden' : 'visible'}.`);
        if (gameState) {
            renderGame(gameState);
        }
    }
}

function getStrategyForPlayer(player) {
    if (!player || typeof player.id === 'undefined') return otherPlayersStrategyConfig;
    return player.id === 0 ? player1StrategyConfig : otherPlayersStrategyConfig;
}

export function initializeGame(isForSimulation = false) {
    if (!isForSimulation) logMessage("Initializing New Game...");
    gameState = new GameState(PLAYER_COUNT);
    gameState.phase = GAME_PHASE.SETUP;
    gameState.isWaitingForBidInput = false;
    gameState.pendingValidBids = [];
    gameState.isAnimating = false;
    // Initialize manual mode flags on gameState
    gameState.isWaitingForManualDiscardSelection = false;
    gameState.numCardsToDiscardManually = 0;
    gameState.isWaitingForManualExchangeChoice = false;
    gameState.isWaitingForManualExchangeCardSelection = false;
    gameState.isWaitingForManualPlay = false;
    selectedCardsForManualAction = []; // Reset global selection

    if (!isForSimulation) {
        const manualToggle = document.getElementById('manual-mode-toggle');
        if (manualToggle) {
            isManualBiddingMode = manualToggle.checked; // This now controls all P0 manual interactions
            manualToggle.addEventListener('change', (event) => {
                isManualBiddingMode = event.target.checked;
                logMessage(`Manual Mode (P0): ${isManualBiddingMode}`);
                if (gameState) renderGame(gameState); // Re-render in case UI needs to change based on mode
            });
        } else { isManualBiddingMode = false; console.warn("Manual mode toggle not found."); }

        logMessage(`Initial Settings -> Animation: ${currentAnimationSpeed.toFixed(1)}s, Ante: ${currentDealerAnte.toFixed(1)}, Muas: ${currentMuasPenalty.toFixed(1)}`);
        logMessage(`Initial Strategy (P0): ${JSON.stringify(player1StrategyConfig)}`);
        logMessage(`Initial Strategy (Others): ${JSON.stringify(otherPlayersStrategyConfig)}`);
        renderGame(gameState);
        logMessage(`Game setup. Dealer: ${gameState.players[gameState.dealerIndex].name}. Click 'Next Step'`);
    }
}

// --- NEW Handler Functions for Manual P0 Actions ---

export function handleManualCardSelectionForDiscardExchange(card) {
    if (!gameState || gameState.turnPlayerIndex !== 0 || !isManualBiddingMode || !card) return;
    if (!gameState.isWaitingForManualDiscardSelection && !gameState.isWaitingForManualExchangeCardSelection) return;

    const cardKey = card.key;
    const cardIndex = selectedCardsForManualAction.findIndex(c => c.key === cardKey);

    if (cardIndex > -1) {
        selectedCardsForManualAction.splice(cardIndex, 1);
    } else {
        if (gameState.isWaitingForManualDiscardSelection && selectedCardsForManualAction.length >= gameState.numCardsToDiscardManually) {
            logMessage(`P0: Cannot select more than ${gameState.numCardsToDiscardManually} cards for this discard.`);
        } else {
            selectedCardsForManualAction.push(card);
        }
    }
    logMessage(`P0 Manual Selection: ${selectedCardsForManualAction.map(c => c.toString()).join(', ')}`);
    renderGame(gameState);
}

export async function handleConfirmManualDiscard() {
    if (!gameState || gameState.turnPlayerIndex !== 0 || !isManualBiddingMode || !gameState.isWaitingForManualDiscardSelection) return;

    const player = gameState.players[0];
    const requiredCount = gameState.numCardsToDiscardManually;

    if (selectedCardsForManualAction.length !== requiredCount) {
        logMessage(`P0 Manual Discard Error: Must select exactly ${requiredCount} card(s). Selected ${selectedCardsForManualAction.length}.`);
        return;
    }

    logMessage(`P0 Confirmed Manual Discard: ${selectedCardsForManualAction.map(c => c.toString()).join(', ')}`);
    const phaseWhenDiscardStarted = gameState.phase;

    gameState.isWaitingForManualDiscardSelection = false;
    gameState.isAnimating = true;
    const nextStepButton = document.getElementById('next-step');
    if (nextStepButton) nextStepButton.disabled = true;

    for (const card of selectedCardsForManualAction) {
        if (!isSimulationRunning) {
            const playerHandElement = document.querySelector(`#player-area-${player.id} .player-hand`);
            const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;
            let sourceForAnimation = cardVisualElement || playerHandElement || `#player-area-${player.id}`;
            if (cardVisualElement) cardVisualElement.style.visibility = 'hidden';
            await animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, { isDiscard: true });
        }
        const removed = player.removeCard(card);
        if (removed) gameState.discardPile.push(removed);
    }
    player.lastActionLog = `Discarded: ${selectedCardsForManualAction.map(c => c.toString()).join(', ')}`;
    selectedCardsForManualAction = [];

    gameState.isAnimating = false;
    if (nextStepButton) nextStepButton.disabled = false; // Will be re-evaluated by nextStep or render
    renderGame(gameState);

    if (phaseWhenDiscardStarted === GAME_PHASE.DEALER_DISCARD && player.id === gameState.dealerIndex) {
        // NOW, apply the transition logic that was in processDealerDiscardStep
        if (gameState.isAutoSneaker) {
            gameState.sneaker = player; // player is P0 (dealer)
            player.status = PLAYER_STATUS.ACTIVE_SNEAKER;
            gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            gameState.turnPlayerIndex = gameState.nextPlayerIndex(player.id); // Next player for stage 2 bids
            // Mark P0 (sneaker) as having "bid" for stage 2, others not yet unless folded
            gameState.players.forEach(p_iterator => {
                 p_iterator.hasBid = (p_iterator === gameState.sneaker || p_iterator.status === PLAYER_STATUS.FOLDED);
            });
            // We don't call moveToNextBidder here directly. Let nextStep handle it.
        } else {
            gameState.phase = GAME_PHASE.BIDDING_STAGE_1;
            gameState.turnPlayerIndex = gameState.nextPlayerIndex(player.id);
            gameState.players.forEach(p_iterator => p_iterator.hasBid = false);
        }
    } else if (phaseWhenDiscardStarted === GAME_PHASE.EXCHANGE_PREP) {
        gameState.needsOderDiscard = false;
        gameState.phase = GAME_PHASE.EXCHANGE;
        gameState.activePlayerOrder = getActivePlayerOrder(gameState);
        gameState.players.forEach(p => p.hasBid = false);
        if (gameState.activePlayerOrder.length > 0) {
            gameState.turnPlayerIndex = (gameState.sneaker && gameState.activePlayerOrder.some(p=>p.id===gameState.sneaker.id)) ? gameState.sneaker.id : gameState.activePlayerOrder[0].id;
        } else { gameState.phase = GAME_PHASE.SCORING; } // Or other end condition
    } else if (phaseWhenDiscardStarted === GAME_PHASE.FINAL_DISCARD) {
        player.hasBid = true;
        await moveToNextFinalDiscarder();
    } else if (phaseWhenDiscardStarted === GAME_PHASE.EXCHANGE) { // Post-Packerl discard
         player.hasBid = true;
         await moveToNextExchanger();
    }
    renderGame(gameState);
    // No automatic nextStep call here; let the main loop or user decide.
}

export async function handleManualExchangeTypeSelection(exchangeType) {
    if (!gameState || gameState.turnPlayerIndex !== 0 || !isManualBiddingMode || !gameState.isWaitingForManualExchangeChoice) return;

    const playerP0 = gameState.players[0];
    logMessage(`P0 Manual Exchange: Chose type - ${exchangeType}`);
    gameState.isWaitingForManualExchangeChoice = false;
    playerP0.exchangeAction = exchangeType; // Store the chosen type
    selectedCardsForManualAction = [];

    if (exchangeType === EXCHANGE_TYPE.STANDARD) {
        gameState.isWaitingForManualExchangeCardSelection = true;
        logMessage("P0: Select 0-4 cards to discard for Standard Exchange, then 'Confirm'.");
        renderGame(gameState); // Show card selection UI for Standard
    } else { // Packerl or Sau - process directly
        gameState.isAnimating = true;
        const nextStepButton = document.getElementById('next-step');
        if (nextStepButton) nextStepButton.disabled = true;

        const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display');

        if (exchangeType === EXCHANGE_TYPE.TRUMPF_PACKERL || exchangeType === EXCHANGE_TYPE.NORMAL_PACKERL) {
            logMessage(`P0 (${playerP0.name}) chose ${exchangeType}. Discarding entire hand.`);
            const handData = [...playerP0.hand];
            for(const card of handData){
                if (!isSimulationRunning) {
                    const el=document.querySelector(`#player-area-${playerP0.id} .player-hand`);
                    const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
                    let src=vis||el||`#player-area-${playerP0.id}`; if(vis)vis.style.visibility='hidden';
                    await animateCardMovement(src, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
                }
                playerP0.removeCard(card); gameState.discardPile.push(card);
            }
            playerP0.hand = [];
            if(!isSimulationRunning) renderGame(gameState);
            await drawCardsForPackerl(playerP0, exchangeType);
            playerP0.lastActionLog = `${exchangeType}, got ${playerP0.hand.length} cards.`;

            if (playerP0.hand.length > 4) {
                gameState.isWaitingForManualDiscardSelection = true;
                gameState.numCardsToDiscardManually = playerP0.hand.length - 4;
                logMessage(`P0: Packerl gave ${playerP0.hand.length} cards. Must discard ${gameState.numCardsToDiscardManually}.`);
            } else {
                playerP0.hasBid = true; // Exchange turn complete
                await moveToNextExchanger();
            }
        } else if (exchangeType === EXCHANGE_TYPE.SAU) {
            const trumpAce = playerP0.hand.find(c => c.rank === 'A' && c.suit === gameState.trumpSuit);
            if (!trumpAce) { logMessage("P0 SAU Error: Trump Ace not found!"); /* UI should prevent this */ }
            else {
                logMessage(`P0 (${playerP0.name}) chose SAU. Discarding all but Trump Ace.`);
                const toDiscard = playerP0.hand.filter(c => c.key !== trumpAce.key);
                for (const card of toDiscard) {
                    if (!isSimulationRunning) {
                        const el=document.querySelector(`#player-area-${playerP0.id} .player-hand`);
                        const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
                        let src=vis||el||`#player-area-${playerP0.id}`; if(vis)vis.style.visibility='hidden';
                        await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});
                    }
                    playerP0.removeCard(card); gameState.discardPile.push(card);
                }
                playerP0.hand = [trumpAce];
                if(!isSimulationRunning) renderGame(gameState);
                await drawCardsForPlayer(playerP0, 3);
                playerP0.lastActionLog = `SAU, got ${playerP0.hand.length} cards.`;
            }
            playerP0.hasBid = true; // Exchange turn complete
            await moveToNextExchanger();
        }
        gameState.isAnimating = false;
        if (nextStepButton) nextStepButton.disabled = gameState.isWaitingForManualDiscardSelection;
        renderGame(gameState);
    }
}

export async function handleConfirmManualStandardExchange() {
    if (!gameState || gameState.turnPlayerIndex !== 0 || !isManualBiddingMode || !gameState.isWaitingForManualExchangeCardSelection) return;

    const playerP0 = gameState.players[0];
    const cardsToDiscard = [...selectedCardsForManualAction];
    const numToDiscard = cardsToDiscard.length;

    if (numToDiscard < 0 || numToDiscard > 4) {
        logMessage(`P0 Manual Standard Exchange Error: Can select 0-4 cards. Selected ${numToDiscard}.`);
        return;
    }

    logMessage(`P0 Confirmed Standard Exchange: Discarding ${numToDiscard} cards: ${cardsToDiscard.map(c => c.toString()).join(', ')}`);
    gameState.isWaitingForManualExchangeCardSelection = false;
    gameState.isAnimating = true;
    const nextStepButton = document.getElementById('next-step');
    if (nextStepButton) nextStepButton.disabled = true;

    const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display');
    for (const card of cardsToDiscard) {
        if (!isSimulationRunning) {
            const el=document.querySelector(`#player-area-${playerP0.id} .player-hand`);
            const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
            let src=vis||el||`#player-area-${playerP0.id}`; if(vis)vis.style.visibility='hidden';
            await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});
        }
        const removed = playerP0.removeCard(card);
        if (removed) gameState.discardPile.push(removed);
    }
    selectedCardsForManualAction = [];
    if(!isSimulationRunning) renderGame(gameState);

    if (numToDiscard > 0) {
        await drawCardsForPlayer(playerP0, numToDiscard);
    }
    playerP0.lastActionLog = `Standard Exchange, discarded ${numToDiscard}.`;
    playerP0.hasBid = true;

    gameState.isAnimating = false;
    if (nextStepButton) nextStepButton.disabled = false;
    renderGame(gameState);

    await moveToNextExchanger();
}

export async function handleManualCardPlay(cardPlayed) {
    if (!gameState || gameState.turnPlayerIndex !== 0 || !isManualBiddingMode || !gameState.isWaitingForManualPlay || !cardPlayed) return;

    const playerP0 = gameState.players[0];
    const validPlays = GameRules.getValidPlays(gameState, playerP0);

    if (!validPlays.some(vp => vp.key === cardPlayed.key)) {
        logMessage(`P0 Manual Play Error: Invalid card - ${cardPlayed.toString()}. Valid: ${validPlays.map(c => c.toString()).join(', ')}`);
        return;
    }

    logMessage(`P0 Played: ${cardPlayed.toString()}`);
    gameState.isWaitingForManualPlay = false;
    // Animation is part of the card playing logic below
    const nextStepButton = document.getElementById('next-step');
    if (nextStepButton) nextStepButton.disabled = true;

    if (!isSimulationRunning) {
        const handArea = document.querySelector(`#player-area-${playerP0.id} .player-hand`);
        const cardVisualElement = handArea ? Array.from(handArea.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(cardPlayed.toString())) : null;
        let sourceForAnimation = cardVisualElement || handArea || `#player-area-${playerP0.id}`;
        if(cardVisualElement) cardVisualElement.style.visibility = 'hidden';
        const trickAreaEl = document.getElementById('trick-area');
        await animateCardMovement(sourceForAnimation, trickAreaEl, cardPlayed, currentAnimationSpeed, { isPlayingToTrick: true, revealAtEnd: false });
    }

    const removed = playerP0.removeCard(cardPlayed);
    if (removed) {
        gameState.currentTrick.push({ player: playerP0, card: cardPlayed });
        playerP0.lastActionLog = `Played: ${cardPlayed.toString()}`;
        playerP0.hasBid = true;
    } else { logMessage("CRITICAL: P0 Manual Play - Failed to remove card."); }

    if (nextStepButton) nextStepButton.disabled = false; // Re-enable after animation potentially
    renderGame(gameState);

    const activePlayersInOrder = getActivePlayerOrder(gameState);
    const expectedInTrick = activePlayersInOrder.filter(p=>p.hand.length > 0 || gameState.currentTrick.some(play=>play.player.id===p.id));

    if (gameState.currentTrick.length >= expectedInTrick.length) {
        gameState.phase = GAME_PHASE.TRICK_END;
    } else {
        moveToNextPlayerInTrick();
    }
    renderGame(gameState); // Update for next player or trick end
}


// --- Original Game Flow Functions (Modified for Manual P0) ---

async function _processChosenBid(player, chosenBid, stage, currentGameState) {
    player.currentBid = chosenBid; if (!isSimulationRunning) player.lastActionLog = `${chosenBid}`; player.hasBid = true;
    if (stage === GAME_PHASE.BIDDING_STAGE_1) {
        switch (chosenBid) {
            case BID_OPTIONS.SNEAK:
                if (currentGameState.oderPlayer) { if (!isSimulationRunning) logMessage(`Sneak by ${player.name} overrides Oder by ${currentGameState.oderPlayer.name}.`); currentGameState.oderPlayer = null; currentGameState.oderType = null; }
                currentGameState.sneaker = player; player.status = PLAYER_STATUS.ACTIVE_SNEAKER; if (!isSimulationRunning) logMessage(`${player.name} bids SNEAK! Transitioning to BIDDING_STAGE_2.`);
                currentGameState.phase = GAME_PHASE.BIDDING_STAGE_2; currentGameState.players.forEach(p => { if (p !== currentGameState.sneaker && p.status !== PLAYER_STATUS.FOLDED) p.hasBid = false; });
                currentGameState.turnPlayerIndex = currentGameState.nextPlayerIndex(player.id); await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, currentGameState); return;
            case BID_OPTIONS.ODER_MIT: case BID_OPTIONS.ODER_OHNE:
                if (currentGameState.sneaker) { if (!isSimulationRunning) logMessage(`Oder by ${player.name} ignored (Sneaker ${currentGameState.sneaker.name} exists).`); }
                else if (!currentGameState.oderPlayer) { currentGameState.oderPlayer = player; currentGameState.oderType = (chosenBid === BID_OPTIONS.ODER_MIT) ? 'mit' : 'ohne'; if (!isSimulationRunning) logMessage(`${player.name} bids ${chosenBid}.`);}
                else { if (!isSimulationRunning) logMessage(`Oder by ${player.name} ignored (Oder by ${currentGameState.oderPlayer.name} exists).`);} break;
            case BID_OPTIONS.WEITER: if (!isSimulationRunning) logMessage(`${player.name} says WEITER.`); break;
        }
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_1, currentGameState);
    } else { // BIDDING_STAGE_2
        switch (chosenBid) {
            case BID_OPTIONS.PLAY: if (!isSimulationRunning) logMessage(`${player.name} bids PLAY.`); player.status = PLAYER_STATUS.ACTIVE_PLAYER; break;
            case BID_OPTIONS.FOLD:
                if (!isSimulationRunning) logMessage(`${player.name} bids FOLD.`); player.status = PLAYER_STATUS.FOLDED; if (!currentGameState.foldedPile) currentGameState.foldedPile = [];
                if (player.hand.length > 0) {
                    if (!isSimulationRunning) logMessage(`Animating ${player.name}'s ${player.hand.length} cards to folded pile concurrently.`);
                    const playerHandElement = document.querySelector(`#player-area-${player.id} .player-hand`); const cardsToFoldData = [...player.hand]; const animationPromises = [];
                    if (!isSimulationRunning && playerHandElement) cardsToFoldData.forEach(cardData => { if (!cardData) return; const cardVisualElement = Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(cardData.toString())); if (cardVisualElement) cardVisualElement.style.visibility = 'hidden'; });
                    for (const cardData of cardsToFoldData) { if (!cardData) continue; if (!isSimulationRunning) { const cardVisualElementForCoords = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null; let sourceForAnimation = cardVisualElementForCoords || playerHandElement || `#player-area-${player.id}`; animationPromises.push(animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, { isDiscard: true })); } }
                    if (!isSimulationRunning) await Promise.all(animationPromises);
                    currentGameState.foldedPile.push(...cardsToFoldData); player.hand = []; if (!isSimulationRunning) renderGame(currentGameState);
                } break;
        }
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, currentGameState);
    }
}

async function moveToNextBidder(stage, currentGameState) {
    let currentTurn = currentGameState.turnPlayerIndex;
    if (currentTurn === -1) { // No one currently set, find first bidder
        if (stage === GAME_PHASE.BIDDING_STAGE_1) {
            currentTurn = currentGameState.nextPlayerIndex(currentGameState.dealerIndex);
        } else { // Stage 2: Start after Sneaker/Oderer
            const initiator = currentGameState.sneaker || currentGameState.oderPlayer;
            currentTurn = initiator ? currentGameState.nextPlayerIndex(initiator.id) : currentGameState.nextPlayerIndex(currentGameState.dealerIndex);
        }
    }
    for (let i = 0; i < currentGameState.players.length; i++) {
        const playerToCheck = currentGameState.players[currentTurn];
        let needsToAct = false;
        if (playerToCheck.status !== PLAYER_STATUS.FOLDED && !playerToCheck.hasBid) {
            if (stage === GAME_PHASE.BIDDING_STAGE_1) {
                needsToAct = true;
            } else if (playerToCheck !== currentGameState.sneaker && playerToCheck !== currentGameState.oderPlayer) { // Stage 2, not the declarer
                needsToAct = true;
            }
        }
        if (needsToAct) {
            currentGameState.turnPlayerIndex = currentTurn;
            if (!isSimulationRunning) logMessage(`moveToNextBidder: Turn is now ${currentGameState.players[currentTurn].name} for ${stage}`);
            return;
        }
        currentTurn = currentGameState.nextPlayerIndex(currentTurn);
    }
    if (!isSimulationRunning) logMessage(`moveToNextBidder: No more players need to act in ${stage}. Resolving stage end.`);
    currentGameState.turnPlayerIndex = -1; // All players have acted or are skipped
    await resolveBiddingStageEnd(stage, currentGameState);
}

async function resolveBiddingStageEnd(stage, currentGameState) {
    if (!isSimulationRunning) logMessage(`Resolving end of ${stage}.`);
    if (stage === GAME_PHASE.BIDDING_STAGE_1) {
        if (currentGameState.sneaker) {
            if (!isSimulationRunning) logMessage("Direct Sneak bid. Stage 1 resolved. Phase already set to Stage 2.");
            if(currentGameState.phase !== GAME_PHASE.BIDDING_STAGE_2) currentGameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, currentGameState);
        } else if (currentGameState.oderPlayer) {
            if (!isSimulationRunning) logMessage(`Bid Stage 1 ended. Oder by ${currentGameState.oderPlayer.name}. Transitioning to Bid Stage 2.`);
            currentGameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            currentGameState.players.forEach(p => { if (p !== currentGameState.oderPlayer && p.status !== PLAYER_STATUS.FOLDED) p.hasBid = false; });
            await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, currentGameState);
        } else {
            if (!isSimulationRunning) logMessage("All players bid Weiter in Stage 1!");
            currentGameState.phase = GAME_PHASE.ALL_WEITER_PENALTY;
        }
    } else { // BIDDING_STAGE_2
        currentGameState.players.forEach(p => p.hasBid = false); // Reset for next phase
        const activePlayersList = getActivePlayerOrder(currentGameState);

        if (currentGameState.oderPlayer) {
            const odererIsStillTheDeclarer = currentGameState.oderPlayer;
            const activePartners = activePlayersList.filter(p => p !== odererIsStillTheDeclarer && p.status === PLAYER_STATUS.ACTIVE_PLAYER);
            const odererStrategy = getStrategyForPlayer(odererIsStillTheDeclarer);
            const odererPlaysAloneByChoice = (odererIsStillTheDeclarer.id === 0 && isManualBiddingMode) // Check if P0 chose to play alone
                                           ? (activePartners.length === 0) // P0 specific logic for playing alone would be set here
                                           : (odererStrategy.bidStage2.playIfLastNoOneJoined && activePartners.length === 0);

            if (odererIsStillTheDeclarer.status !== PLAYER_STATUS.FOLDED && (activePartners.length > 0 || odererPlaysAloneByChoice)) {
                if (!isSimulationRunning) logMessage(`Oder by ${odererIsStillTheDeclarer.name} proceeds with ${activePartners.length} partner(s)${odererPlaysAloneByChoice && activePartners.length === 0 ? " (playing alone)" : ""}. Resolving Oder...`);
                currentGameState.sneaker = odererIsStillTheDeclarer;
                currentGameState.sneaker.status = PLAYER_STATUS.ACTIVE_SNEAKER;
                currentGameState.phase = GAME_PHASE.RESOLVE_ODER;
            } else {
                if (!isSimulationRunning) logMessage(`Oder by ${odererIsStillTheDeclarer.name} does not proceed. Scoring.`);
                currentGameState.phase = GAME_PHASE.SCORING;
            }
        } else if (currentGameState.sneaker) {
            if (activePlayersList.length === 1 && activePlayersList[0] === currentGameState.sneaker) {
                if (!isSimulationRunning) logMessage(`${currentGameState.sneaker.name} wins uncontested! Scoring...`);
                currentGameState.roundWinner = currentGameState.sneaker;
                currentGameState.sneaker.tricksWonThisRound = 4;
                currentGameState.phase = GAME_PHASE.SCORING;
            } else if (activePlayersList.length > 1) {
                if (!isSimulationRunning) logMessage("Bidding Stage 2 complete (Sneaker game). Proceeding to Exchange.");
                currentGameState.activePlayerOrder = activePlayersList;
                currentGameState.phase = GAME_PHASE.EXCHANGE;
                currentGameState.turnPlayerIndex = currentGameState.sneaker.id;
            } else {
                if (!isSimulationRunning) logMessage(`Sneaker ${currentGameState.sneaker.name} has no partners. Scoring.`);
                currentGameState.phase = GAME_PHASE.SCORING;
            }
        } else {
            if (!isSimulationRunning) logMessage("All players bid Weiter in Stage 1. Applying penalty.");
            currentGameState.phase = GAME_PHASE.ALL_WEITER_PENALTY;
        }
    }
}

async function startNewRound() {
    if (!isSimulationRunning) {
        logMessage("Starting new round...");
        logMessage(`--- Config: AnimSpeed=${currentAnimationSpeed.toFixed(1)}s, Ante=${currentDealerAnte.toFixed(1)}, Muas=${currentMuasPenalty.toFixed(1)} ---`);
        logMessage(`--- Strategy (P0): ${JSON.stringify(player1StrategyConfig)} ---`);
        logMessage(`--- Strategy (Others): ${JSON.stringify(otherPlayersStrategyConfig)} ---`);
    }
    gameState.dealerIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
    gameState.players.forEach(p => p.resetRound());
    gameState.deck = new Deck();
    gameState.talon = [];
    gameState.discardPile = [];
    gameState.foldedPile = [];
    gameState.trumpCard = null;
    gameState.trumpSuit = null;
    gameState.originalTrumpCard = null;
    gameState.currentTrick = [];
    gameState.tricksPlayedCount = 0;
    gameState.activePlayerOrder = [];
    gameState.sneaker = null;
    gameState.oderPlayer = null;
    gameState.oderType = null;
    gameState.roundWinner = null;
    gameState.isAutoSneaker = false;
    gameState.needsOderDiscard = false;
    gameState.needsFinalDiscardPlayers = [];
    gameState.isWaitingForBidInput = false;
    gameState.pendingValidBids = [];
    gameState.turnPlayerIndex = -1;
    if (!isSimulationRunning) gameState.lastActionLog = "";
    // Reset manual interaction flags on gameState
    gameState.isWaitingForManualDiscardSelection = false;
    gameState.numCardsToDiscardManually = 0;
    gameState.isWaitingForManualExchangeChoice = false;
    gameState.isWaitingForManualExchangeCardSelection = false;
    gameState.isWaitingForManualPlay = false;
    selectedCardsForManualAction = []; // Reset global selection

    gameState.phase = GAME_PHASE.ANTE;
}

function processAnte() {
    const dealer = gameState.players[gameState.dealerIndex];
    if (!isSimulationRunning) logMessage(`${dealer.name} (Dealer) posts ${currentDealerAnte.toFixed(1)} Ante.`);
    gameState.phase = GAME_PHASE.DEALING;
    gameState.subPhase = 'deal_batch_1';
}

async function processDealingStep() {
    const dealerIndex = gameState.dealerIndex;
    const playerCount = gameState.players.length;
    const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display');

    if (gameState.subPhase === 'deal_batch_1') {
        if (!isSimulationRunning) logMessage("Dealing first 2 cards...");
        for (let c = 0; c < 2; c++) {
            for (let i = 0; i < playerCount; i++) {
                const playerIndex = (dealerIndex + 1 + i) % playerCount;
                const player = gameState.players[playerIndex];
                if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty during deal batch 1."); break; }
                if (!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${playerIndex} .player-hand`, null, currentAnimationSpeed, { isDealing: true, cardIndexInHand: player.hand.length });
                player.addCards(gameState.deck.deal());
                if (!isSimulationRunning) renderGame(gameState);
            }
            if (gameState.deck.isEmpty()) break;
        }
        gameState.subPhase = 'turn_trump';
    } else if (gameState.subPhase === 'turn_trump') {
        if (!isSimulationRunning) logMessage("Turning trump card...");
        if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty before turning trump!"); gameState.phase = GAME_PHASE.ROUND_END; return; }
        let turnedCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; // Peek
        if (!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${dealerIndex} .player-hand`, turnedCardData, currentAnimationSpeed, { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length });
        turnedCardData = gameState.deck.deal(); // Actual deal
        gameState.originalTrumpCard = turnedCardData;
        gameState.players[dealerIndex].addCards(turnedCardData);

        if (turnedCardData.rank === 'A') {
            gameState.isAutoSneaker = true;
            gameState.trumpCard = turnedCardData;
            gameState.trumpSuit = turnedCardData.suit;
        } else if (turnedCardData.rank === WELI_RANK) {
            if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty for second card after Weli!"); gameState.phase = GAME_PHASE.ROUND_END; return; }
            let nextCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; // Peek
            if(!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${dealerIndex} .player-hand`, nextCardData, currentAnimationSpeed, { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length });
            nextCardData = gameState.deck.deal(); // Actual deal
            gameState.trumpCard = nextCardData;
            gameState.trumpSuit = nextCardData.suit;
            gameState.players[dealerIndex].addCards(nextCardData);
        } else {
            gameState.trumpCard = turnedCardData;
            gameState.trumpSuit = turnedCardData.suit;
        }
        if (!isSimulationRunning) renderGame(gameState);
        gameState.subPhase = 'deal_batch_2';
    } else if (gameState.subPhase === 'deal_batch_2') {
        if (!isSimulationRunning) logMessage("Dealing second 2 cards...");
        for (let c = 0; c < 2; c++) {
            for (let i = 0; i < playerCount; i++) {
                const playerIndex = (dealerIndex + 1 + i) % playerCount;
                const player = gameState.players[playerIndex];
                if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty during deal batch 2."); break; }
                if(!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${playerIndex} .player-hand`, null, currentAnimationSpeed, { isDealing: true, cardIndexInHand: player.hand.length });
                player.addCards(gameState.deck.deal());
                if (!isSimulationRunning) renderGame(gameState);
            }
            if (gameState.deck.isEmpty()) break;
        }
        gameState.talon = gameState.deck.cards; // Remaining cards form the talon
        if (!isSimulationRunning) logMessage(`Dealing complete. Talon: ${gameState.talon.length}`);
        gameState.phase = GAME_PHASE.DEALER_DISCARD;
        gameState.subPhase = null;
    }
}

// In controller.js

async function processDealerDiscardStep() {
    const dealer = gameState.players[gameState.dealerIndex];
    const actualDiscardsNeeded = Math.max(0, dealer.hand.length - 4);
    let readyToTransition = false; // Flag to indicate if we should proceed to phase transition

        // Ensure turnPlayerIndex is set if dealer is to act, especially for P0 manual
        if (gameState.turnPlayerIndex === -1 || gameState.turnPlayerIndex !== gameState.dealerIndex) {
            // It's the dealer's "turn" to discard
            gameState.turnPlayerIndex = gameState.dealerIndex;
        }

    if (dealer.id === 0 && isManualBiddingMode) { // P0 is Dealer and in Manual Mode
        if (actualDiscardsNeeded > 0) {
            // P0 Dealer needs to discard manually
            logMessage(`P0 (Dealer) Manual Discard: Needs to discard ${actualDiscardsNeeded}.`);
            gameState.isWaitingForManualDiscardSelection = true;
            gameState.numCardsToDiscardManually = actualDiscardsNeeded;
            selectedCardsForManualAction = []; // Clear previous selections
            renderGame(gameState);
            return; // PAUSE for P0 manual discard input. handleConfirmManualDiscard will resume.
        } else {
            // P0 Dealer needs 0 discards
            if (!isSimulationRunning) logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards. No discard needed.`);
            dealer.lastActionLog = "Discarded 0"; // Log the action
            // P0's discard "action" is complete.
            readyToTransition = true; // Proceed to phase transition logic below
        }
    } else { // AI or non-P0 dealer
        if (actualDiscardsNeeded > 0) {
            if (!isSimulationRunning) logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards, needs to discard ${actualDiscardsNeeded}.`);
            const strategyForDealer = getStrategyForPlayer(dealer);
            const cardsToDiscard = aiDecideCardToDiscard(
                dealer,
                dealer.hand,
                actualDiscardsNeeded,
                "dealer discard",
                gameState.trumpSuit,
                gameState,
                strategyForDealer,
                isSimulationRunning
            );

            if (!cardsToDiscard || cardsToDiscard.length !== actualDiscardsNeeded) {
                if (!isSimulationRunning) logMessage("AI dealer discard error.");
                gameState.phase = GAME_PHASE.ROUND_END; // Or handle error more gracefully
                return;
            }

            for (const card of cardsToDiscard) {
                if (!card) continue;
                if (!isSimulationRunning) {
                    const playerHandElement = document.querySelector(`#player-area-${dealer.id} .player-hand`);
                    const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;
                    let sourceForAnimation = cardVisualElement || playerHandElement || `#player-area-${dealer.id}`;
                    if (cardVisualElement) cardVisualElement.style.visibility = 'hidden';
                    await animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, { isDiscard: true });
                }
                const removed = dealer.removeCard(card);
                if (removed) gameState.discardPile.push(removed);
            }
            if (!isSimulationRunning) dealer.lastActionLog = `Discarded: ${cardsToDiscard.map(c => c.toString()).join(', ')}`;
        } else {
            if (!isSimulationRunning) logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards. No discard needed.`);
            if (!isSimulationRunning) dealer.lastActionLog = "Discarded 0";
        }
        if (!isSimulationRunning) renderGame(gameState); // Render after AI discard
        readyToTransition = true; // AI discard complete, proceed to phase transition
    }

    // Phase Transition Logic (runs if not paused for P0, OR if P0 was dealer and needed 0 discards)
    // Or after P0's manual discard is confirmed and handleConfirmManualDiscard sets readyToTransition or calls nextStep.
    // For clarity, this transition logic is now self-contained here and will be hit
    // once the discard (manual or AI) is resolved for the dealer.
    if (readyToTransition) {
        if (gameState.isAutoSneaker) {
            // Dealer (could be P0 or AI) becomes the Sneaker
            gameState.sneaker = dealer;
            dealer.status = PLAYER_STATUS.ACTIVE_SNEAKER;
            gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            gameState.turnPlayerIndex = gameState.nextPlayerIndex(dealer.id); // Next player starts Stage 2 bidding

            // Mark the Sneaker (dealer) as having "bid" for Stage 2 purposes, so they are skipped.
            // Others have not bid yet in Stage 2 unless folded.
            gameState.players.forEach(p_iterator => {
                p_iterator.hasBid = (p_iterator === gameState.sneaker || p_iterator.status === PLAYER_STATUS.FOLDED);
            });
            // Note: moveToNextBidder will be called by the next call to nextStep()
            // when it processes GAME_PHASE.BIDDING_STAGE_2.
        } else {
            // Not an Auto Sneaker scenario
            gameState.phase = GAME_PHASE.BIDDING_STAGE_1;
            gameState.turnPlayerIndex = gameState.nextPlayerIndex(dealer.id); // Next player starts Stage 1 bidding
            gameState.players.forEach(p_iterator => p_iterator.hasBid = false); // Reset for Stage 1
        }
        // renderGame(gameState); // Render the state after transition (will also be done by nextStep)
    }
    // If P0 was dealer and needed to discard, this function returned early.
    // `handleConfirmManualDiscard` will eventually set the phase and turnPlayerIndex.
}

async function processBiddingStep(stage) {
    if (gameState.turnPlayerIndex === -1) return;
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer) { if (!isSimulationRunning) logMessage(`Error: No current player for bidding stage ${stage}.`); await resolveBiddingStageEnd(stage, gameState); return; }

    let needsToAct = false;
    if (currentPlayer.status !== PLAYER_STATUS.FOLDED && !currentPlayer.hasBid) {
        if (stage === GAME_PHASE.BIDDING_STAGE_1) needsToAct = true;
        else if (currentPlayer !== gameState.sneaker && currentPlayer !== gameState.oderPlayer) needsToAct = true;
    }

    if (!needsToAct) {
        if (!isSimulationRunning && currentPlayer.status !== PLAYER_STATUS.FOLDED) logMessage(`Player ${currentPlayer.name} does not need to act in ${stage} (already bid or is declarer). Moving to next bidder.`);
        await moveToNextBidder(stage, gameState);
        return;
    }

    if (!isSimulationRunning) logMessage(`Bid turn for ${currentPlayer.name} in ${stage}.`);
    const validBids = GameRules.getValidBids(gameState);
    if (validBids.length === 0) {
        if (!isSimulationRunning) logMessage(`No valid bids for ${currentPlayer.name}. Auto-folding.`);
        await _processChosenBid(currentPlayer, BID_OPTIONS.FOLD, stage, gameState);
        return;
    }

    if (currentPlayer.id === 0 && isManualBiddingMode) {
        if (!isSimulationRunning) logMessage(`Requesting manual bid from ${currentPlayer.name}...`);
        gameState.pendingValidBids = validBids;
        gameState.isWaitingForBidInput = true; // This flag is used by uiRenderer
        renderGame(gameState);
        return; // PAUSE for P0 bid
    }

    // AI or non-P0 player's turn
    if (!isSimulationRunning && currentPlayer.id === 0) logMessage(`Getting AI bid for P0 (Manual Mode OFF or Sim)...`);
    else if (!isSimulationRunning) logMessage(`Getting AI bid for ${currentPlayer.name}...`);
    const strategyForPlayer = getStrategyForPlayer(currentPlayer);
    const aiChosenBid = aiDecideBid(currentPlayer, validBids, gameState, strategyForPlayer, isSimulationRunning);
    await _processChosenBid(currentPlayer, validBids.includes(aiChosenBid) ? aiChosenBid : validBids[0], stage, gameState);
}

async function processOderResolution() {
    if (!gameState.oderPlayer || !gameState.sneaker || gameState.oderPlayer !== gameState.sneaker) { if (!isSimulationRunning) logMessage("Oder resolution state error: No Oder player or Sneaker mismatch."); gameState.phase = GAME_PHASE.ROUND_END; return;  }
    const sneakerPlayer = gameState.sneaker;
    if (!isSimulationRunning) logMessage(`Resolving Oder (${gameState.oderType}) for ${sneakerPlayer.name}. Drawing new trump...`);
    const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display');
    const revealSpot = isSimulationRunning ? null : getElementCoordinates('#game-info .game-info-content');
    let newTrumpCardDeterminer = null, drawnWeliAsFirstCard = null, newTrumpSuit = null;
    const originalTrumpSuitIfAny = gameState.originalTrumpCard?.suit;
    let cardsDrawnThisProcess = [], success = false, drawAttempts = 0;
    const maxDrawAttempts = (gameState.talon?.length || 0) + 20; // Safety for talon replenishment

    while (drawAttempts < maxDrawAttempts && !success) {
        drawAttempts++;
        if (gameState.talon.length === 0 && !(await replenishTalonIfNeeded())) { if (!isSimulationRunning) logMessage("Oder fail: Talon empty, cannot replenish."); break; }
        if (!isSimulationRunning) renderGame(gameState); // Show replenished talon if any
        if (gameState.talon.length === 0) { if (!isSimulationRunning) logMessage("Oder fail: Talon still empty after replenish attempt."); break; }

        let cardDrawnData = gameState.talon[gameState.talon.length - 1]; // Peek
        if(!isSimulationRunning) await animateCardMovement(talonCoords, revealSpot, cardDrawnData, currentAnimationSpeed, { revealAtEnd: true });
        cardDrawnData = gameState.talon.pop(); // Actual draw
        if (!cardDrawnData) { if (!isSimulationRunning) logMessage("Oder error: Popped null card from talon."); break; }
        cardsDrawnThisProcess.push(cardDrawnData);
        if (!isSimulationRunning) renderGame(gameState);

        if (!drawnWeliAsFirstCard && cardDrawnData.rank === WELI_RANK) {
            drawnWeliAsFirstCard = cardDrawnData;
            if (!isSimulationRunning) logMessage(`Weli drawn. Will draw another for trump.`);
            if (gameState.talon.length === 0 && !(await replenishTalonIfNeeded())) { if (!isSimulationRunning) logMessage("Oder fail: Talon empty after Weli."); success = false; break; }
            if (!isSimulationRunning) renderGame(gameState);
            continue;
        } else {
            newTrumpCardDeterminer = cardDrawnData;
            if (gameState.oderType === 'mit') {
                newTrumpSuit = newTrumpCardDeterminer.suit;
                success = true;
                if (!isSimulationRunning) logMessage(`Oder Mit: ${newTrumpCardDeterminer} sets trump to ${newTrumpSuit}.`);
            } else { // Oder Ohne
                if (!originalTrumpSuitIfAny) { if (!isSimulationRunning) logMessage("Oder Ohne error: No original trump suit defined (e.g. if Weli was initial trump)."); success = false; break; }
                if (newTrumpCardDeterminer.suit !== originalTrumpSuitIfAny) {
                    newTrumpSuit = newTrumpCardDeterminer.suit;
                    success = true;
                    if (!isSimulationRunning) logMessage(`Oder Ohne: ${newTrumpCardDeterminer} sets trump to ${newTrumpSuit}.`);
                } else {
                    if (!isSimulationRunning) logMessage(`Oder Ohne: Drew ${newTrumpCardDeterminer} (matches original trump ${originalTrumpSuitIfAny}). Discarding.`);
                    gameState.discardPile.push(newTrumpCardDeterminer);
                    newTrumpCardDeterminer = null; // Reset, need to draw again
                }
            }
        }
    }

    if (!success || !newTrumpCardDeterminer) {
        if (!isSimulationRunning) logMessage(`Oder resolution failed for ${sneakerPlayer.name}. Scoring as failure.`);
        cardsDrawnThisProcess.forEach(card => { if (card && card !== drawnWeliAsFirstCard && card !== newTrumpCardDeterminer && !gameState.discardPile.some(dp => dp.key === card.key)) gameState.discardPile.push(card); });
        if (drawnWeliAsFirstCard && !success && !gameState.discardPile.some(dp => dp.key === drawnWeliAsFirstCard.key)) gameState.discardPile.push(drawnWeliAsFirstCard);
        // newTrumpCardDeterminer might be null if last draw was same suit in Ohne
        if (newTrumpCardDeterminer && !success && !gameState.discardPile.some(dp => dp.key === newTrumpCardDeterminer.key)) gameState.discardPile.push(newTrumpCardDeterminer);
        gameState.phase = GAME_PHASE.SCORING;
        gameState.oderPlayer = null; // Clear Oder state
        gameState.oderType = null;
        // Sneaker remains for scoring purposes of failure
        return;
    }

    gameState.trumpCard = newTrumpCardDeterminer;
    gameState.trumpSuit = newTrumpSuit;
    const sneakerHandCoords = isSimulationRunning ? null : getElementCoordinates(`#player-area-${sneakerPlayer.id} .player-hand`);
    if(!isSimulationRunning) await animateCardMovement(revealSpot, sneakerHandCoords, newTrumpCardDeterminer, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length });
    sneakerPlayer.addCards(newTrumpCardDeterminer);
    if (!isSimulationRunning) renderGame(gameState);

    if (drawnWeliAsFirstCard) {
        if(!isSimulationRunning) await animateCardMovement(revealSpot, sneakerHandCoords, drawnWeliAsFirstCard, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length });
        sneakerPlayer.addCards(drawnWeliAsFirstCard);
        if (!isSimulationRunning) renderGame(gameState);
    }

    gameState.needsOderDiscard = (sneakerPlayer.hand.length > 4);
    // Discard other non-essential cards drawn during the process
    cardsDrawnThisProcess.forEach(c => {
        if (c && c.key !== newTrumpCardDeterminer.key && (!drawnWeliAsFirstCard || c.key !== drawnWeliAsFirstCard.key) && !gameState.discardPile.some(dp => dp.key === c.key)) {
            gameState.discardPile.push(c);
        }
    });

    gameState.oderPlayer = null; // Clear successful Oder state
    gameState.oderType = null;
    gameState.activePlayerOrder = getActivePlayerOrder(gameState); // Update active players

    if (gameState.needsOderDiscard) {
        gameState.phase = GAME_PHASE.EXCHANGE_PREP;
        gameState.turnPlayerIndex = sneakerPlayer.id; // Sneaker (Oderer) discards first
    } else {
        gameState.phase = GAME_PHASE.EXCHANGE;
        if (gameState.activePlayerOrder.length > 0) {
            gameState.turnPlayerIndex = (sneakerPlayer && gameState.activePlayerOrder.some(p => p.id === sneakerPlayer.id)) ? sneakerPlayer.id : gameState.activePlayerOrder[0].id;
        } else { gameState.phase = GAME_PHASE.SCORING; } // Should have active players
    }
}

async function processOderDiscardStep() { // Sneaker (from Oder) discards
    const sneakerPlayer = gameState.sneaker; // Oderer became the sneaker
    if (!sneakerPlayer) { logMessage("Error: No sneaker for Oder discard step."); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const discardCount = Math.max(0, sneakerPlayer.hand.length - 4);

    if (gameState.needsOderDiscard && sneakerPlayer.id === 0 && isManualBiddingMode) {
        if (discardCount > 0) {
            logMessage(`P0 (Oder) Manual Discard: Must discard ${discardCount}.`);
            gameState.isWaitingForManualDiscardSelection = true;
            gameState.numCardsToDiscardManually = discardCount;
            selectedCardsForManualAction = [];
            renderGame(gameState);
            return; // PAUSE for P0
        }
        // If 0 discards needed for P0, log and proceed
        if (!isSimulationRunning) logMessage(`Sneaker (${sneakerPlayer.name}, from Oder) has ${sneakerPlayer.hand.length} cards. No discard needed.`);
    } else if (gameState.needsOderDiscard) { // AI or non-P0 Sneaker discard
        if (discardCount > 0) {
            if (!isSimulationRunning) logMessage(`Sneaker (${sneakerPlayer.name}, from Oder) must discard ${discardCount}.`);
            const strategyForSneaker = getStrategyForPlayer(sneakerPlayer);
            const cardsToDiscard = aiDecideCardToDiscard(sneakerPlayer, sneakerPlayer.hand, discardCount, "Oder discard (EXCHANGE_PREP)", gameState.trumpSuit, gameState, strategyForSneaker, isSimulationRunning);
            if (!cardsToDiscard || cardsToDiscard.length !== discardCount) { logMessage("AI Oder discard error."); gameState.phase = GAME_PHASE.ROUND_END; return; }
            for (const card of cardsToDiscard) {
                if (!card) continue;
                if (!isSimulationRunning) {
                    const el = document.querySelector(`#player-area-${sneakerPlayer.id} .player-hand`);
                    const vis = el?Array.from(el.querySelectorAll('.card-image')).find(img=>img&&img.alt&&img.alt.startsWith(card.toString())):null;
                    let src=vis||el||`#player-area-${sneakerPlayer.id}`; if(vis)vis.style.visibility='hidden';
                    await animateCardMovement(src, '#talon-display', null, currentAnimationSpeed, {isDiscard:true});
                }
                const rem = sneakerPlayer.removeCard(card); if (rem) gameState.discardPile.push(rem);
            }
            if (!isSimulationRunning) sneakerPlayer.lastActionLog = `Discarded ${discardCount} (Oder Prep)`;
        } else {
            if (!isSimulationRunning) logMessage(`Sneaker (${sneakerPlayer.name}, from Oder) has ${sneakerPlayer.hand.length} cards. No discard needed.`);
        }
        if (!isSimulationRunning) renderGame(gameState);
    }

    // This logic runs if not paused for P0, or after P0's manual discard is confirmed.
    gameState.needsOderDiscard = false;
    gameState.phase = GAME_PHASE.EXCHANGE;
    gameState.activePlayerOrder = getActivePlayerOrder(gameState);
    gameState.players.forEach(p => p.hasBid = false); // Reset for exchange phase turns
    if (gameState.activePlayerOrder.length > 0) {
        // Sneaker (who was the Oderer) starts the exchange phase
        gameState.turnPlayerIndex = (sneakerPlayer && gameState.activePlayerOrder.some(p=>p.id===sneakerPlayer.id)) ? sneakerPlayer.id : gameState.activePlayerOrder[0].id;
    } else {
        if (gameState.sneaker) { gameState.roundWinner = gameState.sneaker; gameState.phase = GAME_PHASE.SCORING; }
        else { gameState.phase = GAME_PHASE.ROUND_END; }
    }
}

// In controller.js

async function processExchangeStep() {
    if (gameState.turnPlayerIndex === -1) { // No more players to exchange
        await checkAndMoveToFinalDiscard();
        return;
    }
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer || !gameState.activePlayerOrder || !gameState.activePlayerOrder.some(p => p.id === currentPlayer.id) || currentPlayer.hasBid) {
        await moveToNextExchanger(); // Skip if player not active or already exchanged
        return;
    }

    if (currentPlayer.id === 0 && isManualBiddingMode) {
        logMessage(`P0 Manual Exchange: Choose your exchange type.`);
        gameState.isWaitingForManualExchangeChoice = true;
        selectedCardsForManualAction = [];
        renderGame(gameState);
        return; // PAUSE for P0 to choose exchange type
    }

    // AI or non-P0 player's turn
    if (!isSimulationRunning) logMessage(`Exchange turn for ${currentPlayer.name}.`);
    if (gameState.trumpSuit === null) { if (!isSimulationRunning) logMessage("CRITICAL: Trump null in exchange!"); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const validOptions = GameRules.getValidExchangeOptions(currentPlayer, gameState.trumpSuit);
    const strategyForPlayer = getStrategyForPlayer(currentPlayer);
    const decision = aiDecideExchange(currentPlayer, validOptions, gameState.trumpSuit, gameState, strategyForPlayer, isSimulationRunning);

    if (!decision || !decision.type || !validOptions.some(opt => opt.type === decision.type)) {
        if (!isSimulationRunning) logMessage(`AI Error: Invalid exchange decision for ${currentPlayer.name}. Defaulting to Standard, discard 0.`);
        decision.type = EXCHANGE_TYPE.STANDARD; decision.cardsToDiscard = []; // Ensure cardsToDiscard is an empty array
    }
    currentPlayer.exchangeAction = decision.type; // Store action type
    const isPackerl = (decision.type === EXCHANGE_TYPE.TRUMPF_PACKERL || decision.type === EXCHANGE_TYPE.NORMAL_PACKERL);
    const isSau = (decision.type === EXCHANGE_TYPE.SAU);
    const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display');

    if (isPackerl) {
        if (!isSimulationRunning) logMessage(`${currentPlayer.name} chose ${decision.type}. Discarding entire hand.`);
        const handData = [...currentPlayer.hand];
        for(const card of handData){
            if(!card) continue;
            if(!isSimulationRunning){
                const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
                let src=vis||el||`#player-area-${currentPlayer.id}`; if(vis)vis.style.visibility='hidden';
                await animateCardMovement(src, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
            }
            const removedCard = currentPlayer.removeCard(card);
            if (removedCard) gameState.discardPile.push(removedCard);
        }
        currentPlayer.hand=[]; // Ensure hand is empty
        if(!isSimulationRunning)renderGame(gameState);
        await drawCardsForPackerl(currentPlayer, decision.type);

        if (currentPlayer.hand.length > 4) {
            const toDiscardCount = currentPlayer.hand.length - 4;
            if(!isSimulationRunning) logMessage(`AI (${currentPlayer.name}) Packerl: Must discard ${toDiscardCount}`);
            const finalDiscardsData = aiDecideCardToDiscard(currentPlayer, currentPlayer.hand, toDiscardCount, "Packerl final", gameState.trumpSuit, gameState, strategyForPlayer, isSimulationRunning);
            if (finalDiscardsData && Array.isArray(finalDiscardsData)) {
                for(const cardData of finalDiscardsData){
                    if(!cardData) continue;
                    if(!isSimulationRunning){
                        const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                        const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(cardData.toString())):null;
                        let src=vis||el||`#player-area-${currentPlayer.id}`; if(vis)vis.style.visibility='hidden';
                        await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});
                    }
                    const removed = currentPlayer.removeCard(cardData);
                    if(removed) gameState.discardPile.push(removed);
                }
            }
        }
        if(!isSimulationRunning) currentPlayer.lastActionLog=`${decision.type}, kept ${currentPlayer.hand.length}.`;
    } else if (isSau) {
        if(!isSimulationRunning)logMessage(`${currentPlayer.name} chose SAU`);
        const trumpAce=currentPlayer.hand.find(c=>c&&c.rank==='A'&&c.suit===gameState.trumpSuit);
        if(!trumpAce){ if(!isSimulationRunning)logMessage("SAU Error: Trump Ace not found!"); currentPlayer.lastActionLog="SAU Error!"; }
        else {
            const toDiscard = currentPlayer.hand.filter(c=>c&&c.key!==trumpAce.key);
            for(const card of toDiscard){
                if(!card) continue;
                if(!isSimulationRunning){
                    const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                    const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
                    let src=vis||el||`#player-area-${currentPlayer.id}`; if(vis)vis.style.visibility='hidden';
                    await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});
                }
                const removedCard = currentPlayer.removeCard(card);
                if (removedCard) gameState.discardPile.push(removedCard);
            }
            currentPlayer.hand=[trumpAce];
            if(!isSimulationRunning)renderGame(gameState);
            await drawCardsForPlayer(currentPlayer,3);
            if(!isSimulationRunning) currentPlayer.lastActionLog=`SAU, kept ${currentPlayer.hand.length}.`;
        }
    } else { // Standard Exchange for AI
        const cardsToDiscardFromDecision = decision.cardsToDiscard || []; // Ensure it's an array
        if(!isSimulationRunning)logMessage(`${currentPlayer.name} Standard Exchange, discarding ${cardsToDiscardFromDecision.length}`);

        if (Array.isArray(cardsToDiscardFromDecision)) {
            for(const cardToDiscard of cardsToDiscardFromDecision){
                if (cardToDiscard && typeof cardToDiscard.key !== 'undefined') {
                    if(!isSimulationRunning){
                        const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                        const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(cardToDiscard.toString())):null;
                        let src=vis||el||`#player-area-${currentPlayer.id}`; if(vis)vis.style.visibility='hidden';
                        await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});
                    }
                    const removedCard = currentPlayer.removeCard(cardToDiscard);
                    if(removedCard) gameState.discardPile.push(removedCard);
                } else {
                     if (!isSimulationRunning) logMessage(`ERROR: AI (${currentPlayer.name}) - undefined or invalid card object in decision.cardsToDiscard for Standard Exchange.`);
                }
            }
            if(!isSimulationRunning)renderGame(gameState);
            const drawCount = cardsToDiscardFromDecision.length;
            if(drawCount > 0) await drawCardsForPlayer(currentPlayer,drawCount);
            if(!isSimulationRunning) currentPlayer.lastActionLog=`Exchanged, discarded ${drawCount}.`;
        } else {
            if(!isSimulationRunning) logMessage(`ERROR: AI (${currentPlayer.name}) - decision.cardsToDiscard was not an array for Standard Exchange.`);
            if(!isSimulationRunning) currentPlayer.lastActionLog=`Exchange Error.`;
        }
    }
    currentPlayer.hasBid = true; // Mark exchange turn as complete
    if(!isSimulationRunning) renderGame(gameState); // Render after AI action
    await moveToNextExchanger();
}

async function drawCardsForPackerl(player, packerlType) {
    if (!isSimulationRunning) logMessage(`--- Starting ${packerlType} for ${player.name} ---`);
    const talonCoords=isSimulationRunning?null:getElementCoordinates('#talon-display');
    const playerHandCoords=isSimulationRunning?null:getElementCoordinates(`#player-area-${player.id} .player-hand`);
    const initialDrawCount=(packerlType===EXCHANGE_TYPE.TRUMPF_PACKERL)?5:4;
    if(!isSimulationRunning)logMessage(`${player.name} drawing ${initialDrawCount} face-down.`);
    for(let i=0;i<initialDrawCount;i++){
        if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Packerl draw fail: No talon.");break;}
        if(!isSimulationRunning)renderGame(gameState);
        if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Packerl draw fail: Talon empty.");break;}
        if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,null,currentAnimationSpeed,{isDealing:true,cardIndexInHand:player.hand.length});
        const card=gameState.talon.pop(); if(card)player.addCards(card);
        if(!isSimulationRunning)renderGame(gameState);
    }
    let faceUpDraws=0; const MAX_FACE_UP=20; // Safety for endless loop
    do{
        faceUpDraws++;
        if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Packerl face-up fail: No talon.");break;}
        if(!isSimulationRunning)renderGame(gameState);
        if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Packerl face-up fail: Talon empty.");break;}
        const nextCardToDraw = gameState.talon[gameState.talon.length-1]; // Peek for animation
        if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,nextCardToDraw,currentAnimationSpeed,{isDealing:true,revealAtEnd:true,cardIndexInHand:player.hand.length});
        const actualCard = gameState.talon.pop(); // Actual draw
        if(actualCard)player.addCards(actualCard);
        if(!isSimulationRunning)renderGame(gameState);
        if(!actualCard || (!(actualCard.suit===gameState.trumpSuit||actualCard.rank===WELI_RANK))){
            if(!isSimulationRunning)logMessage(actualCard?`Card ${actualCard} NOT Trump - Stopping Packerl face-up draw.`:"No card drawn - Stopping Packerl face-up draw.");
            break;
        }else if(!isSimulationRunning)logMessage(`Card ${actualCard} IS Trump - Keeping and drawing another face-up.`);
        if(faceUpDraws>=MAX_FACE_UP){if(!isSimulationRunning)logMessage("Max face-up draws reached for Packerl.");break;}
    }while(true);
    if(!isSimulationRunning)logMessage(`--- ${packerlType} for ${player.name} Complete. Hand size: ${player.hand.length} ---`);
}

async function drawCardsForPlayer(player, count) {
    if (!isSimulationRunning) logMessage(`${player.name} needs ${count} card(s).`);
    const talonCoords=isSimulationRunning?null:getElementCoordinates('#talon-display');
    const playerHandCoords=isSimulationRunning?null:getElementCoordinates(`#player-area-${player.id} .player-hand`);
    for(let i=0;i<count;i++){
        if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Draw fail: No talon.");break;}
        if(!isSimulationRunning)renderGame(gameState);
        if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Draw fail: Talon empty.");break;}
        if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,null,currentAnimationSpeed,{isDealing:true,cardIndexInHand:player.hand.length});
        const card=gameState.talon.pop(); if(card)player.addCards(card);
        if(!isSimulationRunning)renderGame(gameState);
    }
}

async function moveToNextExchanger() {
    if (!gameState.activePlayerOrder || gameState.activePlayerOrder.length === 0) {
        await checkAndMoveToFinalDiscard();
        return;
    }
    const currentId = gameState.turnPlayerIndex;
    const currentIdxInActiveOrder = gameState.activePlayerOrder.findIndex(p => p.id === currentId);
    let nextPlayer = null;
    if (currentIdxInActiveOrder !== -1) { // If current player was in active order
        for (let i = 1; i <= gameState.activePlayerOrder.length; i++) {
            const nextOrderIdx = (currentIdxInActiveOrder + i) % gameState.activePlayerOrder.length;
            const potentialNextPlayer = gameState.activePlayerOrder[nextOrderIdx];
            if (potentialNextPlayer && !potentialNextPlayer.hasBid) { // hasBid is reset for exchange phase
                nextPlayer = potentialNextPlayer;
                break;
            }
        }
    } else { // Current player not in active order (e.g. start of phase), find first un-actioned active player
        nextPlayer = gameState.activePlayerOrder.find(p => !p.hasBid);
    }

    if (nextPlayer) {
        gameState.turnPlayerIndex = nextPlayer.id;
        if (!isSimulationRunning) logMessage(`Exchange turn to ${nextPlayer.name}.`);
    } else {
        if (!isSimulationRunning) logMessage("All active players completed exchange.");
        gameState.turnPlayerIndex = -1; // Mark phase as done for turn player
        await checkAndMoveToFinalDiscard();
    }
}

async function checkAndMoveToFinalDiscard() {
    if (!isSimulationRunning) logMessage("Exchange phase complete. Checking final discards and SauWeli...");
    if (gameState && gameState.trumpSuit) {
        getActivePlayerOrder(gameState).forEach(player => {
            const hadItBefore = player.hasSauWeli;
            player.checkForSauWeli(gameState.trumpSuit);
            if (player.hasSauWeli && !hadItBefore) {
                if (!player.aiPlan) player.aiPlan = {};
                player.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_ACE';
                if (!isSimulationRunning) logMessage(`Player ${player.name} now has Sau+Weli. AI Plan state set to READY_TO_LEAD_ACE.`);
            } else if (!player.hasSauWeli && player.aiPlan && player.aiPlan.sauWeliLeadState) {
                player.aiPlan.sauWeliLeadState = null;
            }
        });
    } else {
        if (!isSimulationRunning) logMessage("Cannot check SauWeli: No trump or gameState.");
        gameState?.players.forEach(p => {
            p.hasSauWeli = false;
            if (p.aiPlan) p.aiPlan.sauWeliLeadState = null;
        });
    }
    gameState.phase = GAME_PHASE.FINAL_DISCARD;
    gameState.players.forEach(p => p.hasBid = false); // Reset for final discard turns
    gameState.needsFinalDiscardPlayers = getActivePlayerOrder(gameState).filter(p => p.hand.length > 4);
    if (gameState.needsFinalDiscardPlayers.length > 0) {
        gameState.turnPlayerIndex = gameState.needsFinalDiscardPlayers[0].id; // First player in order needing discard
        if (!isSimulationRunning) logMessage(`Final Discard: ${gameState.needsFinalDiscardPlayers.map(p=>`${p.name}(${p.hand.length})`).join(', ')} need to discard.`);
    } else {
        if (!isSimulationRunning) logMessage("No final discards needed.");
        gameState.turnPlayerIndex = -1;
        await checkAndMoveToPlayTricks();
    }
}

async function processFinalDiscardStep() {
    if (gameState.turnPlayerIndex === -1) { // No one needs to discard or all done
        await checkAndMoveToPlayTricks();
        return;
    }
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer || !gameState.needsFinalDiscardPlayers.some(p=>p.id===currentPlayer.id) || currentPlayer.hasBid) {
        await moveToNextFinalDiscarder(); // Skip if not this player's turn or already discarded
        return;
    }

    const count = Math.max(0, currentPlayer.hand.length - 4);

    if (currentPlayer.id === 0 && isManualBiddingMode) {
        if (count > 0) {
            logMessage(`P0 Manual Final Discard: Must discard ${count} card(s).`);
            gameState.isWaitingForManualDiscardSelection = true;
            gameState.numCardsToDiscardManually = count;
            selectedCardsForManualAction = [];
            renderGame(gameState);
            return; // PAUSE for P0
        }
        // If P0 needs 0 discards, log and proceed
        if (!isSimulationRunning) logMessage(`${currentPlayer.name} has 4 cards. No final discard needed.`);
        currentPlayer.lastActionLog="Discarded 0 (Final)";
        currentPlayer.hasBid = true;
        if (!isSimulationRunning) renderGame(gameState);
        await moveToNextFinalDiscarder();
        return;
    }

    // AI or non-P0 player's turn
    if (count > 0) {
        if (!isSimulationRunning) logMessage(`${currentPlayer.name} discards ${count} down to 4.`);
        const strategy = getStrategyForPlayer(currentPlayer);
        const toDiscard = aiDecideCardToDiscard(currentPlayer, currentPlayer.hand, count, "final discard", gameState.trumpSuit, gameState, strategy, isSimulationRunning);
        if(!toDiscard||toDiscard.length!==count){ if(!isSimulationRunning)logMessage("AI final discard error.");gameState.phase=GAME_PHASE.ROUND_END;return;}
        for(const card of toDiscard){
            if(!card)continue;
            if(!isSimulationRunning){
                const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null;
                let src=vis||el||`#player-area-${currentPlayer.id}`; if(vis)vis.style.visibility='hidden';
                await animateCardMovement(src,'#talon-display',null,currentAnimationSpeed,{isDiscard:true});
            }
            const rem=currentPlayer.removeCard(card); if(rem)gameState.discardPile.push(rem);
        }
        if(!isSimulationRunning)currentPlayer.lastActionLog=`Discarded: ${toDiscard.map(c=>c.toString()).join(', ')} (Final)`;
    } else {
        if(!isSimulationRunning)currentPlayer.lastActionLog="Discarded 0 (Final)";
    }
    currentPlayer.hasBid=true;
    if(!isSimulationRunning)renderGame(gameState);
    await moveToNextFinalDiscarder();
}

async function moveToNextFinalDiscarder() {
    const nextDiscarder = gameState.needsFinalDiscardPlayers.find(p => !p.hasBid && p.hand.length > 4);
    if (nextDiscarder) {
        gameState.turnPlayerIndex = nextDiscarder.id;
        if (!isSimulationRunning) logMessage(`Final discard turn to ${nextDiscarder.name}.`);
    } else {
        if (!isSimulationRunning) logMessage("Final discards complete.");
        gameState.turnPlayerIndex = -1;
        await checkAndMoveToPlayTricks();
    }
}

async function checkAndMoveToPlayTricks() {
    if (!isSimulationRunning) logMessage("Checking if play phase can be skipped or who leads...");
    gameState.activePlayerOrder = getActivePlayerOrder(gameState);

    if (gameState.trumpSuit) {
        gameState.activePlayerOrder.forEach(player => {
            const hadItBefore = player.hasSauWeli;
            player.checkForSauWeli(gameState.trumpSuit);
            if (player.hasSauWeli) {
                if (!player.aiPlan) player.aiPlan = {};
                player.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_ACE';
                if (!isSimulationRunning && !hadItBefore) logMessage(`Player ${player.name} has Sau+Weli. Plan: READY_TO_LEAD_ACE.`);
                else if (!isSimulationRunning && hadItBefore && player.aiPlan.sauWeliLeadState !== 'READY_TO_LEAD_ACE') logMessage(`Player ${player.name} still has Sau+Weli. Plan reset to READY_TO_LEAD_ACE.`);
            } else { if (player.aiPlan) player.aiPlan.sauWeliLeadState = null; }
        });
    } else {
        gameState.players.forEach(p => { p.hasSauWeli = false; if(p.aiPlan) p.aiPlan.sauWeliLeadState = null; });
    }
    gameState.players.forEach(p => p.hasBid = false); // Reset for playing turns

    if (gameState.activePlayerOrder.length === 1) {
        const lonePlayer = gameState.activePlayerOrder[0];
        if (!isSimulationRunning) logMessage(`${lonePlayer.name} is only active player. Wins all tricks.`);
        gameState.roundWinner = lonePlayer; lonePlayer.tricksWonThisRound = 4;
        gameState.phase = GAME_PHASE.SCORING; gameState.turnPlayerIndex = -1;
        return;
    } else if (gameState.activePlayerOrder.length === 0) {
        if (!isSimulationRunning) logMessage("No active players. Scoring.");
        gameState.phase = GAME_PHASE.SCORING; gameState.turnPlayerIndex = -1;
        return;
    }

    let firstLeader = (gameState.sneaker && gameState.activePlayerOrder.some(p=>p.id===gameState.sneaker.id)) ? gameState.sneaker : gameState.activePlayerOrder[0];
    if (!isSimulationRunning) logMessage(`${firstLeader.name} leads the first trick.`);
    gameState.turnPlayerIndex = firstLeader.id;
    gameState.trickLeadPlayerIndex = firstLeader.id;
    gameState.currentTrick = [];
    gameState.phase = GAME_PHASE.PLAYING_TRICKS;
}

async function processPlayCardStep() {
    if (gameState.turnPlayerIndex === -1) { // Should be set if in this phase
         logMessage("Error: processPlayCardStep called with no turn player.");
         gameState.phase = GAME_PHASE.SCORING; // Failsafe
         return;
    }
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer || !gameState.activePlayerOrder.some(p=>p.id===currentPlayer.id)) { if(!isSimulationRunning)logMessage("Error: Invalid current player for play."); gameState.phase = gameState.currentTrick.length > 0 ? GAME_PHASE.TRICK_END : GAME_PHASE.ROUND_END; return; }

    if (currentPlayer.hand.length === 0) {
        if(!isSimulationRunning)logMessage(`${currentPlayer.name} has no cards to play.`);
        if(!isSimulationRunning)currentPlayer.lastActionLog="(No cards)";
        currentPlayer.hasBid=true; // Mark turn as "done"
        moveToNextPlayerInTrick();
        return;
    }

    if (currentPlayer.id === 0 && isManualBiddingMode) {
        const validPlays = GameRules.getValidPlays(gameState, currentPlayer);
        if (validPlays.length === 0) { logMessage(`CRITICAL: P0 has no valid plays! Hand: ${currentPlayer.hand.map(c=>c.toString())}`); gameState.phase = GAME_PHASE.ROUND_END; return; }
        logMessage(`P0 Manual Play: Your turn. Valid: ${validPlays.map(c=>c.toString()).join(', ')}. Click a card.`);
        gameState.isWaitingForManualPlay = true;
        renderGame(gameState);
        return; // PAUSE for P0
    }

    // AI or non-P0 player's turn
    if(!isSimulationRunning)logMessage(`Play turn for ${currentPlayer.name}. Trick: [${gameState.currentTrick.map(p=>p.card.toString()).join(', ')}]`);
    const validPlays = GameRules.getValidPlays(gameState, currentPlayer);
    if(validPlays.length===0){if(!isSimulationRunning)logMessage(`CRITICAL: No valid plays for ${currentPlayer.name}!`); gameState.phase=GAME_PHASE.ROUND_END;return;}
    const strategy = getStrategyForPlayer(currentPlayer);
    const aiCard = aiDecideCardToPlay(currentPlayer, validPlays, gameState, strategy, isSimulationRunning);
    let cardToPlay = validPlays.find(vc=>vc&&aiCard&&vc.key===aiCard.key)||validPlays[0];
    if(!cardToPlay){if(!isSimulationRunning)logMessage(`CRITICAL: No card chosen for ${currentPlayer.name}!`); gameState.phase=GAME_PHASE.ROUND_END;return;}

    if(!isSimulationRunning){
        const handArea=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
        const srcEl=handArea?Array.from(handArea.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(cardToPlay.toString())):null;
        let srcAnim=srcEl||handArea||`#player-area-${currentPlayer.id}`; if(srcEl)srcEl.style.visibility='hidden';
        const trickAreaEl=document.getElementById('trick-area');
        await animateCardMovement(srcAnim,trickAreaEl,cardToPlay,currentAnimationSpeed,{isPlayingToTrick:true,revealAtEnd:false});
    }
    const removed=currentPlayer.removeCard(cardToPlay);
    if(removed){
        gameState.currentTrick.push({player:currentPlayer,card:cardToPlay});
        if(!isSimulationRunning){logMessage(`${currentPlayer.name} played ${cardToPlay}`);currentPlayer.lastActionLog=`Played: ${cardToPlay}`;}
        currentPlayer.hasBid=true;
    }else{if(!isSimulationRunning)logMessage("CRITICAL: Failed to remove card."); gameState.phase=GAME_PHASE.ROUND_END;return;}

    if(!isSimulationRunning)renderGame(gameState);

    const activePlayersInOrder = getActivePlayerOrder(gameState);
    const expectedInTrick = activePlayersInOrder.filter(p=>p.hand.length > 0 || gameState.currentTrick.some(play=>play.player.id===p.id));

    if(gameState.currentTrick.length >= expectedInTrick.length) {
        gameState.phase=GAME_PHASE.TRICK_END;
    } else {
        moveToNextPlayerInTrick();
    }
}

function moveToNextPlayerInTrick() {
    if (!gameState.activePlayerOrder || gameState.activePlayerOrder.length === 0) {
        gameState.phase = gameState.currentTrick.length > 0 ? GAME_PHASE.TRICK_END : GAME_PHASE.SCORING;
        return;
    }
    const lastPlayerId = gameState.turnPlayerIndex;
    const lastPlayerIndexInActiveOrder = gameState.activePlayerOrder.findIndex(p => p.id === lastPlayerId);

    if(lastPlayerIndexInActiveOrder === -1){
        if(!isSimulationRunning)logMessage("Error finding last player in active order for trick.");
        gameState.phase=GAME_PHASE.TRICK_END; // Failsafe
        return;
    }
    let nextPlayerToPlay = null;
    for(let i = 1; i <= gameState.activePlayerOrder.length; i++) {
        const nextIndexInOrder = (lastPlayerIndexInActiveOrder + i) % gameState.activePlayerOrder.length;
        const potentialNextPlayer = gameState.activePlayerOrder[nextIndexInOrder];
        // Check if player is still in trick (hasn't played yet) and has cards
        if (potentialNextPlayer && !gameState.currentTrick.some(play => play.player.id === potentialNextPlayer.id) && potentialNextPlayer.hand.length > 0) {
            nextPlayerToPlay = potentialNextPlayer;
            break;
        }
    }
    if(nextPlayerToPlay){
        gameState.turnPlayerIndex = nextPlayerToPlay.id;
        if(!isSimulationRunning)logMessage(`Play turn to ${nextPlayerToPlay.name}.`);
    } else { // All active players with cards have played
        gameState.phase=GAME_PHASE.TRICK_END;
        gameState.turnPlayerIndex = -1; // No specific player's turn for trick end processing
    }
}

async function processTrickEndStep() {
    if(!gameState.currentTrick || gameState.currentTrick.length === 0){
        const cardsLeft = getActivePlayerOrder(gameState).reduce((s,p)=>s+(p.hand?.length||0),0);
        if(cardsLeft===0||gameState.tricksPlayedCount>=4)gameState.phase=GAME_PHASE.SCORING;
        else {if(!isSimulationRunning)logMessage("Warning: Trick end with no cards in trick, but game not over.");gameState.phase=GAME_PHASE.SCORING;} // Or try to recover
        gameState.turnPlayerIndex=-1;return;
    }
    const winner = GameRules.determineTrickWinner(gameState.currentTrick, gameState.trumpSuit);
    if (!winner) { if(!isSimulationRunning)logMessage("Error determining trick winner!"); gameState.phase = GAME_PHASE.ROUND_END; return; }
    const winningCard = gameState.currentTrick.find(p=>p.player.id===winner.id)?.card;
    winner.tricksWonThisRound++;

    if(!isSimulationRunning){
        logMessage(`Trick ${gameState.tricksPlayedCount+1} won by ${winner.name} with ${winningCard?winningCard.toString():'N/A'}.`);
        winner.lastActionLog=`Won trick ${gameState.tricksPlayedCount+1}`;
    }

    const playThatLedTrick = gameState.currentTrick[0];
    if (playThatLedTrick && playThatLedTrick.player.id === winner.id) { // Winner led the trick
        const leader = winner;
        if (leader.aiPlan && leader.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_ACE' && playThatLedTrick.card.rank === 'A' && playThatLedTrick.card.suit === gameState.trumpSuit) {
            const weliStillInHand = leader.hand.find(c => c && c.rank === WELI_RANK);
            if (weliStillInHand) {
                leader.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_WELI';
                if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Ace and won. Ready to lead Weli.`);
            } else {
                leader.aiPlan.sauWeliLeadState = null; leader.hasSauWeli = false;
                 if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Ace, won, but Weli gone. Plan ended.`);
            }
        } else if (leader.aiPlan && leader.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_WELI' && playThatLedTrick.card.rank === WELI_RANK) {
            leader.aiPlan.sauWeliLeadState = 'COMPLETED';
            if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Weli and won. Plan completed.`);
        }
    } else if (playThatLedTrick && playThatLedTrick.player.aiPlan && playThatLedTrick.player.aiPlan.sauWeliLeadState) { // Leader lost trick
        if (!isSimulationRunning) logMessage(`AI (${playThatLedTrick.player.name}): SauWeli plan: Led ${playThatLedTrick.card} but lost. Plan disrupted.`);
        playThatLedTrick.player.aiPlan.sauWeliLeadState = null;
        const stillHasAce = playThatLedTrick.player.hand.some(c=>c.rank === 'A' && c.suit === gameState.trumpSuit);
        const stillHasWeli = playThatLedTrick.player.hand.some(c=>c.rank === WELI_RANK);
        if (!stillHasAce || !stillHasWeli) playThatLedTrick.player.hasSauWeli = false; // Update if components lost
    }

    if(!isSimulationRunning){
        const trickCoords=getElementCoordinates('#trick-area');
        const srcAnim={top:trickCoords.top+(trickCoords.height/2)-(108/2),left:trickCoords.left+(trickCoords.width/2)-(72/2)};
        const winnerArea=`#player-area-${winner.id}`;
        await animateCardMovement(srcAnim,winnerArea,null,currentAnimationSpeed*0.6,{isDiscard:true});
    }
    if(!gameState.discardPile)gameState.discardPile=[];
    gameState.discardPile.push(...gameState.currentTrick.map(p=>p.card).filter(c=>c));
    gameState.currentTrick=[];
    if(!isSimulationRunning)renderGame(gameState);
    gameState.tricksPlayedCount++;
    gameState.players.forEach(p=>p.hasBid=false); // Reset for next trick

    if(gameState.tricksPlayedCount>=4){
        gameState.phase=GAME_PHASE.SCORING;
        gameState.turnPlayerIndex=-1;
    } else {
        if(getActivePlayerOrder(gameState).some(p=>p.id===winner.id)){
            gameState.phase=GAME_PHASE.PLAYING_TRICKS;
            gameState.turnPlayerIndex=winner.id; // Winner leads next trick
            gameState.trickLeadPlayerIndex=winner.id;
        } else {
            if(!isSimulationRunning)logMessage("Error: Trick winner not active or found.");
            gameState.phase=GAME_PHASE.SCORING;gameState.turnPlayerIndex=-1;
        }
    }
}

function processAllWeiterPenalty() {
    if (!isSimulationRunning) logMessage("Applying 'All Weiter' penalty.");
    const scores = GameRules.calculateAllWeiterScores(gameState, currentDealerAnte);
    gameState.players.forEach(player => {
        const scoreInfo = scores[player.id];
        if (scoreInfo) {
            player.points += scoreInfo.points;
            if (!isSimulationRunning) player.lastActionLog = `All Weiter (${scoreInfo.points >= 0 ? '+' : ''}${scoreInfo.points.toFixed(1)})`;
        } else if (!isSimulationRunning) player.lastActionLog = `All Weiter (Error)`;
    });
    gameState.phase = GAME_PHASE.ROUND_END;
    gameState.turnPlayerIndex = -1;
    if (!isSimulationRunning) gameState.lastActionLog = `Round ended: All Weiter.`;
}

function processScoringStep() {
    if (!isSimulationRunning) logMessage("Calculating scores...");
    let scores;
    try {
        scores = GameRules.calculateRoundScores(gameState, currentDealerAnte, currentMuasPenalty);
    } catch (error) {
        if (!isSimulationRunning) logMessage("Scoring error: " + error.message);
        gameState.phase = GAME_PHASE.ROUND_END; gameState.turnPlayerIndex = -1; return;
    }
    let summary = "Round scored: ";
    for (const player of gameState.players) {
        const info = scores[player.id];
        if (info) {
            player.points += info.points;
            if (!isSimulationRunning) {
                let desc=(gameState.roundWinner&&player===gameState.roundWinner)?`Won Uncontested!`:
                         (player.status===PLAYER_STATUS.ACTIVE_SNEAKER)?(info.tricks>=2?`Sneaker Success!`:`Sneaker Failed!`):
                         (player.status===PLAYER_STATUS.ACTIVE_PLAYER)?(info.tricks>=1?`Player Success`:`Player Failed!`):
                         (player.status===PLAYER_STATUS.FOLDED)?`Folded`:`(Inactive)`;
                player.lastActionLog = `${desc} (${info.points>=0?'+':''}${info.points.toFixed(1)})`;
                summary += `${player.name} ${player.lastActionLog}; `;
            }
        } else if(!isSimulationRunning){player.lastActionLog=`(Score Error)`; summary += `${player.name} (Error); `;}
    }
    gameState.phase = GAME_PHASE.ROUND_END;
    gameState.turnPlayerIndex = -1;
    if(!isSimulationRunning)gameState.lastActionLog = summary.trim();
}

// In controller.js

export async function nextStep() {
    if (!gameState) {
        logMessage("Error: gameState is null.");
        return;
    }

    // Check if P0 is currently waiting for manual input
    const p0IsCurrentlyWaiting = gameState.turnPlayerIndex === 0 && isManualBiddingMode &&
        (gameState.isWaitingForBidInput ||
         gameState.isWaitingForManualDiscardSelection ||
         gameState.isWaitingForManualExchangeChoice ||
         gameState.isWaitingForManualExchangeCardSelection ||
         gameState.isWaitingForManualPlay);

    if (p0IsCurrentlyWaiting) {
        if (!isSimulationRunning) logMessage("Waiting for P0 manual input... (Next Step clicked while P0 should act)");
        renderGame(gameState); // Ensure UI is correct
        const btn = document.getElementById('next-step');
        if (btn) btn.disabled = true; // Keep it disabled
        return; // P0 needs to make their choice via UI, not Next Step
    }

    if (gameState.isAnimating) {
        if (!isSimulationRunning) logMessage("Animation in progress, please wait...");
        return;
    }

    // --- Start of a processing step ---
    gameState.isAnimating = true;
    const btn = document.getElementById('next-step');
    if (btn) btn.disabled = true;

    const phaseBeforeStep = gameState.phase;
    const subPhaseBeforeStep = gameState.subPhase;
    const turnPlayerBeforeStep = gameState.turnPlayerIndex;

    if (!isSimulationRunning) {
        let turnPlayerName = 'N/A';
        if (gameState.turnPlayerIndex !== -1 && gameState.players[gameState.turnPlayerIndex]) {
            turnPlayerName = gameState.players[gameState.turnPlayerIndex].name;
        }
        logMessage(`--- Executing Step: Current Phase [${phaseBeforeStep}${subPhaseBeforeStep ? ':'+subPhaseBeforeStep : ''}] (Turn: ${turnPlayerName}) ---`);
    }

    try {
        switch (gameState.phase) {
            case GAME_PHASE.SETUP:
            case GAME_PHASE.ROUND_END:
                await startNewRound();
                break;
            case GAME_PHASE.ANTE:
                processAnte();
                break;
            case GAME_PHASE.DEALING:
                await processDealingStep();
                break;
            case GAME_PHASE.DEALER_DISCARD:
                await processDealerDiscardStep();
                break;
            case GAME_PHASE.BIDDING_STAGE_1:
                await processBiddingStep(GAME_PHASE.BIDDING_STAGE_1);
                break;
            case GAME_PHASE.RESOLVE_ODER:
                await processOderResolution();
                break;
            case GAME_PHASE.BIDDING_STAGE_2:
                await processBiddingStep(GAME_PHASE.BIDDING_STAGE_2);
                break;
            case GAME_PHASE.EXCHANGE_PREP:
                await processOderDiscardStep();
                break;
            case GAME_PHASE.EXCHANGE:
                await processExchangeStep();
                break;
            case GAME_PHASE.FINAL_DISCARD:
                await processFinalDiscardStep();
                break;
            case GAME_PHASE.PLAYING_TRICKS:
                await processPlayCardStep();
                break;
            case GAME_PHASE.TRICK_END:
                await processTrickEndStep();
                break;
            case GAME_PHASE.ALL_WEITER_PENALTY:
                processAllWeiterPenalty();
                break;
            case GAME_PHASE.SCORING:
                processScoringStep();
                break;
            default:
                if (!isSimulationRunning) logMessage(`Error: Unknown game phase: ${gameState.phase}`);
                gameState.phase = GAME_PHASE.ROUND_END;
        }
    } catch (error) {
        if (!isSimulationRunning) logMessage(`!!! Runtime Error in phase ${gameState.phase} (during ${phaseBeforeStep}): ${error.message} !!!`);
        console.error("Error during phase execution:", phaseBeforeStep, gameState.phase, error.stack);
        gameState.phase = GAME_PHASE.ROUND_END;
        gameState.lastActionLog = `Error: ${error.message}`;
    } finally {
        gameState.isAnimating = false; // Reset after the step
    }

    // After a step, check if the game got stuck (more relevant for single step execution)
    const p0IsNowWaitingAfterProcessing = gameState.turnPlayerIndex === 0 && isManualBiddingMode &&
    (gameState.isWaitingForBidInput || gameState.isWaitingForManualDiscardSelection ||
     gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection ||
     gameState.isWaitingForManualPlay);


if (p0IsNowWaitingAfterProcessing) {
    // P0 is waiting for manual input.
    if (!isSimulationRunning) logMessage(`--- Paused for P0 Input: Phase [${gameState.phase}] Player: P0 ---`);
    renderGame(gameState);
    if (btn) btn.disabled = true; // Disable Next Step, P0 must act via UI
} else {
    // No P0 manual action is immediately pending, or the round/game might have ended.
    renderGame(gameState); // Render the outcome of the step

    if (gameState.phase === GAME_PHASE.ROUND_END) {
        if (btn) btn.disabled = false; // <<<< ENABLE Next Step to start a new round
        if (!isSimulationRunning) {
            logMessage(`--- Round Ended. Click Next Step to start a new round. ---`);
        }
    } else {
        // Game is ongoing, not P0's turn for immediate manual action
        if (btn) btn.disabled = gameState.isAnimating; // Only disable if an animation is flagged (should be false here)
        if (!isSimulationRunning) {
            const errEnd = gameState.lastActionLog?.includes("Error"); // Check if an error ended the round implicitly
            if (!errEnd) { // Avoid double "round end" if error already indicated it
                let currentTurnPlayerName = 'N/A';
                if(gameState.turnPlayerIndex !== -1 && gameState.players[gameState.turnPlayerIndex]){
                    currentTurnPlayerName = gameState.players[gameState.turnPlayerIndex].name;
                }
                logMessage(`--- Step Complete: Now Phase [${gameState.phase}${gameState.subPhase ? ':'+gameState.subPhase : ''}] (Turn: ${currentTurnPlayerName}) ---`);
            }
        }
    }
}
}

export async function handleUserBid(chosenBid) {
    if (!gameState || !gameState.isWaitingForBidInput) return;
    const player = gameState.players[gameState.turnPlayerIndex];
    const valid = gameState.pendingValidBids;
    const stage = gameState.phase;
    if (!player) { gameState.isWaitingForBidInput = false; return; }
    logMessage(`User (${player.name}) selected bid: ${chosenBid}`);
    if (!valid.includes(chosenBid)) { logMessage(`Invalid bid selected by user: ${chosenBid}. Valid: ${valid.join(', ')}`); renderGame(gameState); return; }

    gameState.isWaitingForBidInput = false;
    gameState.pendingValidBids = [];
    gameState.isAnimating = true;
    const btn = document.getElementById('next-step');
    if (btn) btn.disabled = true;

    await _processChosenBid(player, chosenBid, stage, gameState);

    gameState.isAnimating = false;
    const p0IsWaitingAfterBid = gameState.turnPlayerIndex === 0 && isManualBiddingMode &&
        (gameState.isWaitingForBidInput || gameState.isWaitingForManualDiscardSelection ||
         gameState.isWaitingForManualExchangeChoice || gameState.isWaitingForManualExchangeCardSelection ||
         gameState.isWaitingForManualPlay);
    if (btn) btn.disabled = p0IsWaitingAfterBid || gameState.isAnimating;
    renderGame(gameState);

    if (!p0IsWaitingAfterBid && !gameState.isAnimating && gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SETUP) {
        // logMessage(`--- Bid Processed. Consider auto-advancing if next is not P0 manual... ---`);
        // If you want auto-advance after P0 bid and next is not P0 manual:
        // if(gameState.turnPlayerIndex !== 0 || !isManualBiddingMode) {
        //    setTimeout(() => nextStep(), 50);
        // }
    } else if (p0IsWaitingAfterBid) {
        logMessage(`--- Bid Processed. Pausing for next manual input for P0. ---`);
    }
}

async function playFullGameSilently() {
    gameState.isWaitingForBidInput = false; gameState.isAnimating = false;
    gameState.isWaitingForManualDiscardSelection = false;
    gameState.isWaitingForManualExchangeChoice = false;
    gameState.isWaitingForManualExchangeCardSelection = false;
    gameState.isWaitingForManualPlay = false;

    let safetyBreak = 0; const MAX_STEPS_PER_GAME = 700;
    while (gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SETUP && safetyBreak < MAX_STEPS_PER_GAME) {
        safetyBreak++; const phaseBefore = gameState.phase; const turnPlayerBefore = gameState.turnPlayerIndex;
        try {
            switch (gameState.phase) {
                case GAME_PHASE.ANTE: processAnte(); break;
                case GAME_PHASE.DEALING: await processDealingStep(); break;
                case GAME_PHASE.DEALER_DISCARD: await processDealerDiscardStep(); break;
                case GAME_PHASE.BIDDING_STAGE_1: await processBiddingStep(GAME_PHASE.BIDDING_STAGE_1); break;
                case GAME_PHASE.RESOLVE_ODER: await processOderResolution(); break;
                case GAME_PHASE.BIDDING_STAGE_2: await processBiddingStep(GAME_PHASE.BIDDING_STAGE_2); break;
                case GAME_PHASE.EXCHANGE_PREP: await processOderDiscardStep(); break;
                case GAME_PHASE.EXCHANGE: await processExchangeStep(); break;
                case GAME_PHASE.FINAL_DISCARD: await processFinalDiscardStep(); break;
                case GAME_PHASE.PLAYING_TRICKS: await processPlayCardStep(); break;
                case GAME_PHASE.TRICK_END: await processTrickEndStep(); break;
                case GAME_PHASE.ALL_WEITER_PENALTY: processAllWeiterPenalty(); break;
                case GAME_PHASE.SCORING: processScoringStep(); break;
                default: gameState.phase = GAME_PHASE.ROUND_END;
            }
        } catch (error) { console.error(`SIM Error in ${phaseBefore}: ${error.message}`, error.stack); gameState.phase = GAME_PHASE.ROUND_END; }
        if (gameState.phase === phaseBefore && gameState.turnPlayerIndex === turnPlayerBefore && gameState.phase !== GAME_PHASE.ROUND_END && gameState.turnPlayerIndex !== -1) {
            console.warn(`SIM: Game stuck in phase ${gameState.phase}, player ${gameState.turnPlayerIndex}. Forcing end.`);
            gameState.phase = GAME_PHASE.ROUND_END;
        }
    }
    if (safetyBreak >= MAX_STEPS_PER_GAME) {
        console.warn(`SIM: Max steps per game reached. Forcing scoring/end. Phase: ${gameState.phase}`);
        if (gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SCORING) processScoringStep();
        gameState.phase = GAME_PHASE.ROUND_END;
    }
}

export async function runBatchSimulation(numGames, progressCallback) {
    isSimulationRunning = true;
    logMessage(`Starting batch simulation for ${numGames} games... (UI updates disabled)`);

    const aggregatedPlayerPoints = Array(PLAYER_COUNT).fill(0);
    const playerNames = gameState ? gameState.players.map(p => p.name) : Array(PLAYER_COUNT).fill(null).map((_,i) => `P${i}`);
    let gamesSuccessfullyCompleted = 0;
    const initialUiPlayerPoints = gameState ? gameState.players.map(p => p.points) : Array(PLAYER_COUNT).fill(0);

    for (let i = 0; i < numGames; i++) {
        initializeGame(true); // isForSimulation = true
        await startNewRound();
        await playFullGameSilently();

        if (gameState.phase === GAME_PHASE.ROUND_END) {
            gamesSuccessfullyCompleted++;
            gameState.players.forEach((player, index) => {
                aggregatedPlayerPoints[index] += player.points;
                if (!playerNames[index] && player.name) playerNames[index] = player.name;
            });
        }

        if (progressCallback) {
            const percentComplete = ((i + 1) / numGames) * 100;
            await new Promise(resolve => setTimeout(resolve, 0));
            progressCallback(percentComplete);
        }

        if ((i + 1) % Math.max(1, Math.floor(numGames / 20)) === 0 || i + 1 === numGames) {
             // Only log final completion in silent sim to avoid spam
             if ( (i+1) === numGames) logMessage(`SIM: Completed ${i + 1} / ${numGames} games...`);
        }
    }

    isSimulationRunning = false;
    logMessage(`Batch simulation finished. ${gamesSuccessfullyCompleted}/${numGames} games completed successfully.`);

    initializeGame(false); // Re-initialize for UI play
    if (gameState && initialUiPlayerPoints) { // Restore pre-simulation points for UI players
        gameState.players.forEach((p, idx) => p.points = initialUiPlayerPoints[idx]);
        renderGame(gameState);
    }

    return {
        playerNames: playerNames,
        totalPoints: aggregatedPlayerPoints,
        gamesSimulated: numGames,
        gamesCompleted: gamesSuccessfullyCompleted
    };
}