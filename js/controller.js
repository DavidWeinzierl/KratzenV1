

import { GameState, GameRules, Card, Deck } from './gameLogic.js';
import { aiDecideBid, aiDecideExchange, aiDecideCardToPlay, aiDecideCardToDiscard } from './aiPlayer.js';
import { renderGame, animateCardMovement, getElementCoordinates } from './uiRenderer.js';
import { logMessage } from './logger.js';
import { PLAYER_STATUS, GAME_PHASE, BID_OPTIONS, EXCHANGE_TYPE, WELI_RANK, RANKS } from './constants.js';

let gameState = null;
const PLAYER_COUNT = 4;
let isManualBiddingMode = false;

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

    if (!isForSimulation) {
        const manualToggle = document.getElementById('manual-mode-toggle');
        if (manualToggle) {
            isManualBiddingMode = manualToggle.checked;
            manualToggle.addEventListener('change', (event) => {
                isManualBiddingMode = event.target.checked;
                logMessage(`Manual Mode: ${isManualBiddingMode}`);
                if (gameState && gameState.isWaitingForBidInput) renderGame(gameState);
            });
        } else { isManualBiddingMode = false; console.warn("Manual mode toggle not found."); }

        logMessage(`Initial Settings -> Animation: ${currentAnimationSpeed.toFixed(1)}s, Ante: ${currentDealerAnte.toFixed(1)}, Muas: ${currentMuasPenalty.toFixed(1)}`);
        logMessage(`Initial Strategy (P0): ${JSON.stringify(player1StrategyConfig)}`);
        logMessage(`Initial Strategy (Others): ${JSON.stringify(otherPlayersStrategyConfig)}`);
        renderGame(gameState);
        logMessage(`Game setup. Dealer: ${gameState.players[gameState.dealerIndex].name}. Click 'Next Step'`);
    }
}


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
                    for (const cardData of cardsToFoldData) { if (!cardData) continue; if (!isSimulationRunning) { const cardVisualElementForCoords = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null; let sourceForAnimation = playerHandElement || `#player-area-${player.id}`; if (cardVisualElementForCoords) sourceForAnimation = cardVisualElementForCoords; else if (!isSimulationRunning) logMessage(`Fold: Card visual for ${cardData.toString()} not found. Animating from general hand area.`); animationPromises.push(animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, { isDiscard: true })); } }
                    if (!isSimulationRunning) await Promise.all(animationPromises);
                    currentGameState.foldedPile.push(...cardsToFoldData); player.hand = []; if (!isSimulationRunning) renderGame(currentGameState); 
                } break;
        }
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, currentGameState); 
    }
}

async function moveToNextBidder(stage, currentGameState) { 
    let currentTurn = currentGameState.turnPlayerIndex;
    if (currentTurn === -1) { if (stage === GAME_PHASE.BIDDING_STAGE_1) currentTurn = currentGameState.nextPlayerIndex(currentGameState.dealerIndex); else { const initiator = currentGameState.sneaker || currentGameState.oderPlayer; currentTurn = initiator ? currentGameState.nextPlayerIndex(initiator.id) : currentGameState.nextPlayerIndex(currentGameState.dealerIndex); } }
    for (let i = 0; i < currentGameState.players.length; i++) {
        const playerToCheck = currentGameState.players[currentTurn]; let needsToAct = false;
        if (playerToCheck.status !== PLAYER_STATUS.FOLDED && !playerToCheck.hasBid) { if (stage === GAME_PHASE.BIDDING_STAGE_1) needsToAct = true; else if (playerToCheck !== currentGameState.sneaker && playerToCheck !== currentGameState.oderPlayer) needsToAct = true; }
        if (needsToAct) { currentGameState.turnPlayerIndex = currentTurn; if (!isSimulationRunning) logMessage(`moveToNextBidder: Turn is now ${currentGameState.players[currentTurn].name} for ${stage}`); return; }
        currentTurn = currentGameState.nextPlayerIndex(currentTurn);
    }
    if (!isSimulationRunning) logMessage(`moveToNextBidder: No more players need to act in ${stage}. Resolving stage end.`); currentGameState.turnPlayerIndex = -1; await resolveBiddingStageEnd(stage, currentGameState); 
}




async function resolveBiddingStageEnd(stage, currentGameState) {
    if (!isSimulationRunning) logMessage(`Resolving end of ${stage}.`);
    if (stage === GAME_PHASE.BIDDING_STAGE_1) {
        // Stage 1 logic remains the same
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
        currentGameState.players.forEach(p => p.hasBid = false);

        const activePlayersList = getActivePlayerOrder(currentGameState); // Players who haven't FOLDED

        if (currentGameState.oderPlayer) { // An Oder was the initial declaration from Stage 1
            // The Oderer (currentGameState.oderPlayer) does not bid in Stage 2.
            // We need to check if they are still 'WAITING' or if their status changed due to an override (e.g. a Sneak that was then overridden).
            // For a pure Oder game, the Oderer's status should not be FOLDED unless the game logic is flawed elsewhere.
            // The primary check is if they have partners.

            const odererIsStillTheDeclarer = currentGameState.oderPlayer; // Store for clarity
            const activePartners = activePlayersList.filter(p => p !== odererIsStillTheDeclarer && p.status === PLAYER_STATUS.ACTIVE_PLAYER);
            const odererStrategy = getStrategyForPlayer(odererIsStillTheDeclarer);
            const odererPlaysAloneByChoice = odererStrategy.bidStage2.playIfLastNoOneJoined && activePartners.length === 0;

            // Oderer proceeds if they have at least one partner OR they are playing alone by choice.
            // The Oderer themselves *must* be considered active unless a Sneak overrode them (which isn't this case from the log).
            // The critical part is that the Oderer is NOT `PLAYER_STATUS.FOLDED`.
            if (odererIsStillTheDeclarer.status !== PLAYER_STATUS.FOLDED && (activePartners.length > 0 || odererPlaysAloneByChoice)) {
                if (!isSimulationRunning) logMessage(`Oder by ${odererIsStillTheDeclarer.name} proceeds with ${activePartners.length} partner(s) or playing alone by choice. Resolving Oder...`);
                
                // Set the Oderer as the Sneaker for game flow purposes
                currentGameState.sneaker = odererIsStillTheDeclarer;
                currentGameState.sneaker.status = PLAYER_STATUS.ACTIVE_SNEAKER;
                // Partners are already PLAYER_STATUS.ACTIVE_PLAYER from their "Play" bid.
                currentGameState.phase = GAME_PHASE.RESOLVE_ODER;
            } else {
                // Oderer fails if they have no partners and are not playing alone,
                // or if the Oderer somehow got folded (which shouldn't happen if they are the Oderer).
                if (!isSimulationRunning) {
                    if (odererIsStillTheDeclarer.status === PLAYER_STATUS.FOLDED) { // This should be a rare/error case for an Oderer
                        logMessage(`Oder by ${odererIsStillTheDeclarer.name} fails because Oderer's status is FOLDED.`);
                    } else {
                        logMessage(`Oder by ${odererIsStillTheDeclarer.name} does not proceed (no partners and not configured to play alone).`);
                    }
                }
                currentGameState.phase = GAME_PHASE.SCORING; // Game ends, Oderer fails
            }
        } else if (currentGameState.sneaker) { // A direct Sneak was the initial declaration
            // Check if the Sneaker is the *only* one left in the activePlayersList.
            if (activePlayersList.length === 1 && activePlayersList[0] === currentGameState.sneaker) {
                if (!isSimulationRunning) logMessage(`${currentGameState.sneaker.name} wins uncontested (all others folded after Sneak bid)! Scoring...`);
                currentGameState.roundWinner = currentGameState.sneaker;
                currentGameState.sneaker.tricksWonThisRound = 4;
                currentGameState.phase = GAME_PHASE.SCORING;
            } else if (activePlayersList.length > 1) { // Sneaker has at least one partner
                if (!isSimulationRunning) logMessage("Bidding Stage 2 complete (Sneaker game with partners). Proceeding to Exchange.");
                currentGameState.activePlayerOrder = activePlayersList; 
                currentGameState.phase = GAME_PHASE.EXCHANGE; 
                currentGameState.turnPlayerIndex = currentGameState.sneaker.id;  
            } else { // activePlayersList.length === 0, or Sneaker somehow not in it.
                if (!isSimulationRunning) logMessage(`Bidding Stage 2 ended for Sneaker ${currentGameState.sneaker.name}, but no one (or not Sneaker) is active. Scoring.`);
                currentGameState.phase = GAME_PHASE.SCORING; // Sneaker fails if no partners and they didn't play alone (or they folded)
            }
        } else { 
            // No OderPlayer and no Sneaker set - this means All Weiter from Stage 1
            if (!isSimulationRunning) logMessage("All players bid Weiter in Stage 1. Applying penalty."); 
            currentGameState.phase = GAME_PHASE.ALL_WEITER_PENALTY; 
        }
    }
}




async function startNewRound() { if (!isSimulationRunning) { logMessage("Starting new round..."); logMessage(`--- Config: AnimSpeed=${currentAnimationSpeed.toFixed(1)}s, Ante=${currentDealerAnte.toFixed(1)}, Muas=${currentMuasPenalty.toFixed(1)} ---`); logMessage(`--- Strategy (P0): ${JSON.stringify(player1StrategyConfig)} ---`); logMessage(`--- Strategy (Others): ${JSON.stringify(otherPlayersStrategyConfig)} ---`); } gameState.dealerIndex = gameState.nextPlayerIndex(gameState.dealerIndex); gameState.players.forEach(p => p.resetRound()); gameState.deck = new Deck(); gameState.talon = []; gameState.discardPile = []; gameState.foldedPile = []; gameState.trumpCard = null; gameState.trumpSuit = null; gameState.originalTrumpCard = null; gameState.currentTrick = []; gameState.tricksPlayedCount = 0; gameState.activePlayerOrder = []; gameState.sneaker = null; gameState.oderPlayer = null; gameState.oderType = null; gameState.roundWinner = null; gameState.isAutoSneaker = false; gameState.needsOderDiscard = false; gameState.needsFinalDiscardPlayers = []; gameState.isWaitingForBidInput = false; gameState.pendingValidBids = []; gameState.turnPlayerIndex = -1; if (!isSimulationRunning) gameState.lastActionLog = ""; gameState.phase = GAME_PHASE.ANTE; }
function processAnte() { const dealer = gameState.players[gameState.dealerIndex]; if (!isSimulationRunning) logMessage(`${dealer.name} (Dealer) posts ${currentDealerAnte.toFixed(1)} Ante.`); gameState.phase = GAME_PHASE.DEALING; gameState.subPhase = 'deal_batch_1';}
async function processDealingStep() { const dealerIndex = gameState.dealerIndex; const playerCount = gameState.players.length; const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display'); if (gameState.subPhase === 'deal_batch_1') { if (!isSimulationRunning) logMessage("Dealing first 2 cards..."); for (let c = 0; c < 2; c++) { for (let i = 0; i < playerCount; i++) { const playerIndex = (dealerIndex + 1 + i) % playerCount; const player = gameState.players[playerIndex]; if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty during deal batch 1."); break; } if (!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${playerIndex} .player-hand`, null, currentAnimationSpeed, { isDealing: true, cardIndexInHand: player.hand.length }); player.addCards(gameState.deck.deal()); if (!isSimulationRunning) renderGame(gameState); } if (gameState.deck.isEmpty()) break; } gameState.subPhase = 'turn_trump'; } else if (gameState.subPhase === 'turn_trump') { if (!isSimulationRunning) logMessage("Turning trump card..."); if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty before turning trump!"); gameState.phase = GAME_PHASE.ROUND_END; return; } let turnedCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; if (!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${dealerIndex} .player-hand`, turnedCardData, currentAnimationSpeed, { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length }); turnedCardData = gameState.deck.deal(); gameState.originalTrumpCard = turnedCardData; gameState.players[dealerIndex].addCards(turnedCardData); if (turnedCardData.rank === 'A') { gameState.isAutoSneaker = true; gameState.trumpCard = turnedCardData; gameState.trumpSuit = turnedCardData.suit; } else if (turnedCardData.rank === WELI_RANK) { if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty for second card after Weli!"); gameState.phase = GAME_PHASE.ROUND_END; return; } let nextCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; if(!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${dealerIndex} .player-hand`, nextCardData, currentAnimationSpeed, { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length }); nextCardData = gameState.deck.deal(); gameState.trumpCard = nextCardData; gameState.trumpSuit = nextCardData.suit; gameState.players[dealerIndex].addCards(nextCardData); } else { gameState.trumpCard = turnedCardData; gameState.trumpSuit = turnedCardData.suit; } if (!isSimulationRunning) renderGame(gameState); gameState.subPhase = 'deal_batch_2'; } else if (gameState.subPhase === 'deal_batch_2') { if (!isSimulationRunning) logMessage("Dealing second 2 cards..."); for (let c = 0; c < 2; c++) { for (let i = 0; i < playerCount; i++) { const playerIndex = (dealerIndex + 1 + i) % playerCount; const player = gameState.players[playerIndex]; if (gameState.deck.isEmpty()) { if (!isSimulationRunning) logMessage("Deck empty during deal batch 2."); break; } if(!isSimulationRunning) await animateCardMovement(talonCoords, `#player-area-${playerIndex} .player-hand`, null, currentAnimationSpeed, { isDealing: true, cardIndexInHand: player.hand.length }); player.addCards(gameState.deck.deal()); if (!isSimulationRunning) renderGame(gameState); } if (gameState.deck.isEmpty()) break; } gameState.talon = gameState.deck.cards; if (!isSimulationRunning) logMessage(`Dealing complete. Talon: ${gameState.talon.length}`); gameState.phase = GAME_PHASE.DEALER_DISCARD; gameState.subPhase = null; } }

async function processDealerDiscardStep() {
    const dealer = gameState.players[gameState.dealerIndex];
    const actualDiscardsNeeded = Math.max(0, dealer.hand.length - 4);
    const strategyForDealer = getStrategyForPlayer(dealer);

    if (actualDiscardsNeeded > 0) {
        if (!isSimulationRunning) logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards, needs to discard ${actualDiscardsNeeded}.`);
        
        const cardsToDiscard = aiDecideCardToDiscard(
            dealer,
            dealer.hand,
            actualDiscardsNeeded,
            "dealer discard",
            gameState.trumpSuit,
            gameState,
            strategyForDealer,
            isSimulationRunning // Pass isSimulationRunning here
        );

        if (!cardsToDiscard || cardsToDiscard.length !== actualDiscardsNeeded) {
            if (!isSimulationRunning) logMessage("AI dealer discard error.");
            gameState.phase = GAME_PHASE.ROUND_END;
            return;
        }

        for (const card of cardsToDiscard) {
            if (!card) continue;
            if (!isSimulationRunning) {
                const playerHandElement = document.querySelector(`#player-area-${dealer.id} .player-hand`);
                if (playerHandElement) void playerHandElement.offsetHeight;
                const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image')).find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;
                let sourceForAnimation = playerHandElement || `#player-area-${dealer.id}`;
                if (cardVisualElement) {
                    sourceForAnimation = cardVisualElement;
                    cardVisualElement.style.visibility = 'hidden';
                } else if (!isSimulationRunning) {
                    logMessage(`Dealer Discard: Card visual for ${card.toString()} not found. Animating from general hand area.`);
                }
                await animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, { isDiscard: true });
            }
            const removed = dealer.removeCard(card);
            if (removed) gameState.discardPile.push(removed);
            if (!isSimulationRunning) renderGame(gameState);
        }
        if (!isSimulationRunning) dealer.lastActionLog = `Discarded: ${cardsToDiscard.map(c => c.toString()).join(', ')}`;
    } else {
        if (!isSimulationRunning) logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards. No discard needed.`);
    }

    if (gameState.isAutoSneaker) {
        gameState.sneaker = dealer;
        gameState.sneaker.status = PLAYER_STATUS.ACTIVE_SNEAKER;
        gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
        gameState.turnPlayerIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
        gameState.players.forEach(p => { p.hasBid = (p === gameState.sneaker || p.status === PLAYER_STATUS.FOLDED); });
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2, gameState);
    } else {
        gameState.phase = GAME_PHASE.BIDDING_STAGE_1;
        gameState.turnPlayerIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
        gameState.players.forEach(p => p.hasBid = false);
    }
}

async function processBiddingStep(stage) { if (gameState.turnPlayerIndex === -1) return; const currentPlayer = gameState.players[gameState.turnPlayerIndex]; if (!currentPlayer) { if (!isSimulationRunning) logMessage(`Error: No current player for bidding stage ${stage}.`); await resolveBiddingStageEnd(stage, gameState); return; } let needsToAct = false; if (currentPlayer.status !== PLAYER_STATUS.FOLDED && !currentPlayer.hasBid) { if (stage === GAME_PHASE.BIDDING_STAGE_1) needsToAct = true; else if (currentPlayer !== gameState.sneaker && currentPlayer !== gameState.oderPlayer) needsToAct = true; } if (!needsToAct) { if (!isSimulationRunning) logMessage(`Player ${currentPlayer.name} does not need to act in ${stage}. Moving to next bidder.`); await moveToNextBidder(stage, gameState); return; } if (!isSimulationRunning) logMessage(`Bid turn for ${currentPlayer.name} in ${stage}.`); const validBids = GameRules.getValidBids(gameState); if (validBids.length === 0) { if (!isSimulationRunning) logMessage(`No valid bids for ${currentPlayer.name}. Auto-folding.`); await _processChosenBid(currentPlayer, BID_OPTIONS.FOLD, stage, gameState); return; } const strategyForPlayer = getStrategyForPlayer(currentPlayer); if (!isSimulationRunning && isManualBiddingMode && currentPlayer.id === 0) { if (!isSimulationRunning) logMessage(`Requesting manual bid from ${currentPlayer.name}...`); gameState.pendingValidBids = validBids; gameState.isWaitingForBidInput = true; } else { if (!isSimulationRunning && currentPlayer.id === 0) logMessage(`Getting AI bid for P0 (Manual Mode OFF or Sim)...`); else if (!isSimulationRunning) logMessage(`Getting AI bid for ${currentPlayer.name}...`); const aiChosenBid = aiDecideBid(currentPlayer, validBids, gameState, strategyForPlayer, isSimulationRunning); await _processChosenBid(currentPlayer, validBids.includes(aiChosenBid) ? aiChosenBid : validBids[0], stage, gameState); } }
async function processOderResolution() { if (!gameState.oderPlayer || !gameState.sneaker || gameState.oderPlayer !== gameState.sneaker) { if (!isSimulationRunning) logMessage("Oder resolution state error: No Oder player or Sneaker mismatch."); gameState.phase = GAME_PHASE.ROUND_END; return;  } const sneakerPlayer = gameState.sneaker; if (!isSimulationRunning) logMessage(`Resolving Oder (${gameState.oderType}) for ${sneakerPlayer.name}. Drawing new trump...`); const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display'); const revealSpot = isSimulationRunning ? null : getElementCoordinates('#game-info .game-info-content'); let newTrumpCardDeterminer = null, drawnWeliAsFirstCard = null, newTrumpSuit = null; const originalTrumpSuitIfAny = gameState.originalTrumpCard?.suit; let cardsDrawnThisProcess = [], success = false, drawAttempts = 0; const maxDrawAttempts = (gameState.talon?.length || 0) + 20; while (drawAttempts < maxDrawAttempts && !success) { drawAttempts++; if (gameState.talon.length === 0 && !(await replenishTalonIfNeeded())) { if (!isSimulationRunning) logMessage("Oder fail: Talon empty, cannot replenish."); break; } if (!isSimulationRunning) renderGame(gameState); if (gameState.talon.length === 0) { if (!isSimulationRunning) logMessage("Oder fail: Talon still empty after replenish attempt."); break; } let cardDrawnData = gameState.talon[gameState.talon.length - 1]; if(!isSimulationRunning) await animateCardMovement(talonCoords, revealSpot, cardDrawnData, currentAnimationSpeed, { revealAtEnd: true }); cardDrawnData = gameState.talon.pop(); if (!cardDrawnData) { if (!isSimulationRunning) logMessage("Oder error: Popped null card from talon."); break; } cardsDrawnThisProcess.push(cardDrawnData); if (!isSimulationRunning) renderGame(gameState); if (!drawnWeliAsFirstCard && cardDrawnData.rank === WELI_RANK) { drawnWeliAsFirstCard = cardDrawnData; if (!isSimulationRunning) logMessage(`Weli drawn. Will draw another for trump.`); if (gameState.talon.length === 0 && !(await replenishTalonIfNeeded())) { if (!isSimulationRunning) logMessage("Oder fail: Talon empty after Weli."); success = false; break; } if (!isSimulationRunning) renderGame(gameState);  continue;  } else { newTrumpCardDeterminer = cardDrawnData; if (gameState.oderType === 'mit') { newTrumpSuit = newTrumpCardDeterminer.suit; success = true; if (!isSimulationRunning) logMessage(`Oder Mit: ${newTrumpCardDeterminer} sets trump to ${newTrumpSuit}.`); } else {  if (!originalTrumpSuitIfAny) { if (!isSimulationRunning) logMessage("Oder Ohne error: No original trump."); success = false; break; } if (newTrumpCardDeterminer.suit !== originalTrumpSuitIfAny) { newTrumpSuit = newTrumpCardDeterminer.suit; success = true; if (!isSimulationRunning) logMessage(`Oder Ohne: ${newTrumpCardDeterminer} sets trump to ${newTrumpSuit}.`); } else { if (!isSimulationRunning) logMessage(`Oder Ohne: Drew ${newTrumpCardDeterminer} (matches original). Discarding.`); gameState.discardPile.push(newTrumpCardDeterminer); newTrumpCardDeterminer = null;  } } } } if (!success || !newTrumpCardDeterminer) { if (!isSimulationRunning) logMessage(`Oder resolution failed for ${sneakerPlayer.name}.`); cardsDrawnThisProcess.forEach(card => { if (card && card !== drawnWeliAsFirstCard && card !== newTrumpCardDeterminer && !gameState.discardPile.some(dp => dp.key === card.key)) gameState.discardPile.push(card); }); if (drawnWeliAsFirstCard && !success && !gameState.discardPile.some(dp => dp.key === drawnWeliAsFirstCard.key)) gameState.discardPile.push(drawnWeliAsFirstCard); if (newTrumpCardDeterminer && !success && !gameState.discardPile.some(dp => dp.key === newTrumpCardDeterminer.key)) gameState.discardPile.push(newTrumpCardDeterminer); gameState.phase = GAME_PHASE.SCORING; gameState.oderPlayer = null; gameState.oderType = null; return; } gameState.trumpCard = newTrumpCardDeterminer; gameState.trumpSuit = newTrumpSuit; const sneakerHandCoords = isSimulationRunning ? null : getElementCoordinates(`#player-area-${sneakerPlayer.id} .player-hand`); if(!isSimulationRunning) await animateCardMovement(revealSpot, sneakerHandCoords, newTrumpCardDeterminer, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length }); sneakerPlayer.addCards(newTrumpCardDeterminer); if (!isSimulationRunning) renderGame(gameState); if (drawnWeliAsFirstCard) { if(!isSimulationRunning) await animateCardMovement(revealSpot, sneakerHandCoords, drawnWeliAsFirstCard, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length }); sneakerPlayer.addCards(drawnWeliAsFirstCard); if (!isSimulationRunning) renderGame(gameState);  } gameState.needsOderDiscard = (sneakerPlayer.hand.length > 4); cardsDrawnThisProcess.forEach(c => { if (c && c.key !== newTrumpCardDeterminer.key && (!drawnWeliAsFirstCard || c.key !== drawnWeliAsFirstCard.key) && !gameState.discardPile.some(dp => dp.key === c.key)) gameState.discardPile.push(c); }); gameState.oderPlayer = null; gameState.oderType = null; gameState.activePlayerOrder = getActivePlayerOrder(gameState); if (gameState.needsOderDiscard) { gameState.phase = GAME_PHASE.EXCHANGE_PREP; gameState.turnPlayerIndex = sneakerPlayer.id; } else { gameState.phase = GAME_PHASE.EXCHANGE; if (gameState.activePlayerOrder.length > 0) gameState.turnPlayerIndex = (sneakerPlayer && gameState.activePlayerOrder.some(p => p.id === sneakerPlayer.id)) ? sneakerPlayer.id : gameState.activePlayerOrder[0].id; else gameState.phase = GAME_PHASE.SCORING;  } }

async function processOderDiscardStep() { 
    if (gameState.needsOderDiscard && gameState.sneaker && gameState.turnPlayerIndex === gameState.sneaker.id) { 
        const discardCount = Math.max(0, gameState.sneaker.hand.length - 4); 
        const strategyForSneaker = getStrategyForPlayer(gameState.sneaker); 
        if (discardCount > 0) { 
            if (!isSimulationRunning) logMessage(`Sneaker (${gameState.sneaker.name}, from Oder) must discard ${discardCount}.`); 
            const cardsToDiscard = aiDecideCardToDiscard(gameState.sneaker, gameState.sneaker.hand, discardCount, "Oder discard (EXCHANGE_PREP)", gameState.trumpSuit, gameState, strategyForSneaker, isSimulationRunning); 
            if (!cardsToDiscard || cardsToDiscard.length !== discardCount) { if (!isSimulationRunning) logMessage("AI Oder discard error."); gameState.phase = GAME_PHASE.ROUND_END; return; } 
            for (const card of cardsToDiscard) { 
                if (!card) continue; 
                if (!isSimulationRunning) { 
                    const el = document.querySelector(`#player-area-${gameState.sneaker.id} .player-hand`); 
                    if(el) void el.offsetHeight; 
                    const vis = el ? Array.from(el.querySelectorAll('.card-image')).find(img=>img&&img.alt&&img.alt.startsWith(card.toString())):null; 
                    let src=el||`#player-area-${gameState.sneaker.id}`; 
                    if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage(`Oder Discard: Card visual for ${card.toString()} not found.`); 
                    await animateCardMovement(src, '#talon-display', null, currentAnimationSpeed, {isDiscard:true});
                } 
                const rem = gameState.sneaker.removeCard(card); if (rem) gameState.discardPile.push(rem); 
                if (!isSimulationRunning) renderGame(gameState);
            } 
            if (!isSimulationRunning) gameState.sneaker.lastActionLog = `Discarded ${discardCount} (Oder Prep)`; 
        } 
    } 
    gameState.needsOderDiscard = false; 
    gameState.phase = GAME_PHASE.EXCHANGE; 
    gameState.activePlayerOrder = getActivePlayerOrder(gameState); 
    gameState.players.forEach(p => p.hasBid = false); 
    if (gameState.activePlayerOrder.length > 0) {
        gameState.turnPlayerIndex = (gameState.sneaker && gameState.activePlayerOrder.some(p=>p.id===gameState.sneaker.id)) ? gameState.sneaker.id : gameState.activePlayerOrder[0].id; 
    } else { 
        if (gameState.sneaker) { gameState.roundWinner = gameState.sneaker; gameState.phase = GAME_PHASE.SCORING; } 
        else { gameState.phase = GAME_PHASE.ROUND_END; } 
    } 
}

async function processExchangeStep() { 
    const currentPlayer = gameState.players[gameState.turnPlayerIndex]; 
    if (!currentPlayer || !gameState.activePlayerOrder || !gameState.activePlayerOrder.some(p => p.id === currentPlayer.id) || currentPlayer.hasBid) { await moveToNextExchanger(); if (gameState.phase === GAME_PHASE.EXCHANGE && !gameState.isWaitingForBidInput && !gameState.isAnimating && !isSimulationRunning) setTimeout(() => nextStep(), 10); return; } 
    if (!isSimulationRunning) logMessage(`Exchange turn for ${currentPlayer.name}.`); 
    if (gameState.trumpSuit === null) { if (!isSimulationRunning) logMessage("CRITICAL: Trump null in exchange!"); gameState.phase = GAME_PHASE.ROUND_END; return; } 
    const validOptions = GameRules.getValidExchangeOptions(currentPlayer, gameState.trumpSuit); 
    const strategyForPlayer = getStrategyForPlayer(currentPlayer); 
    const decision = aiDecideExchange(currentPlayer, validOptions, gameState.trumpSuit, gameState, strategyForPlayer, isSimulationRunning); 
    if (!decision || !decision.type || !validOptions.some(opt => opt.type === decision.type)) { if (!isSimulationRunning) logMessage(`AI Error: Invalid exchange decision. Defaulting to Standard, discard 0.`); decision.type = EXCHANGE_TYPE.STANDARD; decision.cardsToDiscard = []; } 
    currentPlayer.exchangeAction = decision.type; currentPlayer.hasBid = true; 
    const isPackerl = (decision.type === EXCHANGE_TYPE.TRUMPF_PACKERL || decision.type === EXCHANGE_TYPE.NORMAL_PACKERL); 
    const isSau = (decision.type === EXCHANGE_TYPE.SAU); 
    const talonCoords = isSimulationRunning ? null : getElementCoordinates('#talon-display'); 
    if (isPackerl) { 
        if (!isSimulationRunning) logMessage(`${currentPlayer.name} chose ${decision.type}. Discarding entire hand.`); 
        const handData = [...currentPlayer.hand]; 
        for(const card of handData){ if(!card)continue; if(!isSimulationRunning){const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); if(el)void el.offsetHeight; const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null; let src=el||`#player-area-${currentPlayer.id}`; if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage("Packerl Discard: visual not found"); await animateCardMovement(src, talonCoords, null, currentAnimationSpeed, {isDiscard:true});}} 
        gameState.discardPile.push(...handData.filter(c=>c)); currentPlayer.hand=[]; 
        if(!isSimulationRunning)renderGame(gameState); 
        await drawCardsForPackerl(currentPlayer, decision.type); 
        if(currentPlayer.hand.length>4){
            const toDiscardCount=currentPlayer.hand.length-4; 
            if(!isSimulationRunning)logMessage(`Packerl for ${currentPlayer.name} must discard ${toDiscardCount}`); 
            const finalDiscardsData=aiDecideCardToDiscard(currentPlayer,currentPlayer.hand,toDiscardCount,"Packerl final",gameState.trumpSuit,gameState,strategyForPlayer, isSimulationRunning); 
            for(const cardData of finalDiscardsData){if(!cardData)continue; if(!isSimulationRunning){const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); if(el)void el.offsetHeight; const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(cardData.toString())):null; let src=el||`#player-area-${currentPlayer.id}`; if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage("Packerl Final Discard: visual not found"); await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});} 
            const rem=currentPlayer.removeCard(cardData); if(rem)gameState.discardPile.push(rem); if(!isSimulationRunning)renderGame(gameState);}} 
        if(!isSimulationRunning)currentPlayer.lastActionLog=`${decision.type}, kept ${currentPlayer.hand.length}.`;
    } else if (isSau) { 
        if(!isSimulationRunning)logMessage(currentPlayer.name+" chose SAU"); 
        const trumpAce=currentPlayer.hand.find(c=>c&&c.rank==='A'&&c.suit===gameState.trumpSuit); 
        if(!trumpAce){if(!isSimulationRunning)logMessage("SAU Error!");if(!isSimulationRunning)currentPlayer.lastActionLog="SAU Error!";}
        else{
            const toDiscard=currentPlayer.hand.filter(c=>c&&c.key!==trumpAce.key); 
            for(const card of toDiscard){if(!card)continue;if(!isSimulationRunning){const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); if(el)void el.offsetHeight; const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null; let src=el||`#player-area-${currentPlayer.id}`; if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage("Sau Discard: visual not found"); await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});}} 
            gameState.discardPile.push(...toDiscard.filter(c=>c)); currentPlayer.hand=[trumpAce]; 
            if(!isSimulationRunning)renderGame(gameState); 
            await drawCardsForPlayer(currentPlayer,4); 
            if(!isSimulationRunning)currentPlayer.lastActionLog=`SAU, kept ${currentPlayer.hand.length}.`;
        }
    } else { 
        const toDiscard=decision.cardsToDiscard?[...decision.cardsToDiscard.filter(c=>c)]:[]; 
        if(!isSimulationRunning)logMessage(currentPlayer.name+" Standard, discarding "+toDiscard.length); 
        for(const card of toDiscard){if(!isSimulationRunning){const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); if(el)void el.offsetHeight; const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null; let src=el||`#player-area-${currentPlayer.id}`; if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage("Standard Discard: visual not found"); await animateCardMovement(src,talonCoords,null,currentAnimationSpeed,{isDiscard:true});} 
        const rem=currentPlayer.removeCard(card); if(rem)gameState.discardPile.push(rem); if(!isSimulationRunning)renderGame(gameState);} 
        const drawCount=toDiscard.length; if(drawCount>0)await drawCardsForPlayer(currentPlayer,drawCount); 
        if(!isSimulationRunning)currentPlayer.lastActionLog=`Exchanged, discarded ${drawCount}.`;
    } 
    await moveToNextExchanger(); 
}

async function drawCardsForPackerl(player, packerlType) { if (!isSimulationRunning) logMessage(`--- Starting ${packerlType} for ${player.name} ---`); const talonCoords=isSimulationRunning?null:getElementCoordinates('#talon-display'); const playerHandCoords=isSimulationRunning?null:getElementCoordinates(`#player-area-${player.id} .player-hand`); const initialDrawCount=(packerlType===EXCHANGE_TYPE.TRUMPF_PACKERL)?5:4; if(!isSimulationRunning)logMessage(`${player.name} drawing ${initialDrawCount} face-down.`); for(let i=0;i<initialDrawCount;i++){if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Packerl draw fail: No talon.");break;} if(!isSimulationRunning)renderGame(gameState); if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Packerl draw fail: Talon empty.");break;} if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,null,currentAnimationSpeed,{isDealing:true,cardIndexInHand:player.hand.length}); const card=gameState.talon.pop(); if(card)player.addCards(card); if(!isSimulationRunning)renderGame(gameState);} let faceUpDraws=0; const MAX_FACE_UP=20; do{faceUpDraws++; if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Packerl face-up fail: No talon.");break;} if(!isSimulationRunning)renderGame(gameState); if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Packerl face-up fail: Talon empty.");break;} const nextCard=gameState.talon[gameState.talon.length-1]; if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,nextCard,currentAnimationSpeed,{isDealing:true,revealAtEnd:true,cardIndexInHand:player.hand.length}); const actualCard=gameState.talon.pop(); if(actualCard)player.addCards(actualCard); if(!isSimulationRunning)renderGame(gameState); if(!actualCard||(!(actualCard.suit===gameState.trumpSuit||actualCard.rank===WELI_RANK))){if(!isSimulationRunning)logMessage(actualCard?`Card ${actualCard} NOT Trump - Stopping.`:"No card drawn.");break;}else if(!isSimulationRunning)logMessage(`Card ${actualCard} IS Trump - Keeping.`); if(faceUpDraws>=MAX_FACE_UP){if(!isSimulationRunning)logMessage("Max face-up draws.");break;}}while(true); if(!isSimulationRunning)logMessage(`--- ${packerlType} for ${player.name} Complete. Hand: ${player.hand.length} ---`);}
async function drawCardsForPlayer(player, count) { if (!isSimulationRunning) logMessage(`${player.name} needs ${count} card(s).`); const talonCoords=isSimulationRunning?null:getElementCoordinates('#talon-display'); const playerHandCoords=isSimulationRunning?null:getElementCoordinates(`#player-area-${player.id} .player-hand`); for(let i=0;i<count;i++){if(!await replenishTalonIfNeeded()){if(!isSimulationRunning)logMessage("Draw fail: No talon.");break;} if(!isSimulationRunning)renderGame(gameState); if(gameState.talon.length===0){if(!isSimulationRunning)logMessage("Draw fail: Talon empty.");break;} if(!isSimulationRunning)await animateCardMovement(talonCoords,playerHandCoords,null,currentAnimationSpeed,{isDealing:true,cardIndexInHand:player.hand.length}); const card=gameState.talon.pop(); if(card)player.addCards(card); if(!isSimulationRunning)renderGame(gameState);}}
async function moveToNextExchanger() { if (!gameState.activePlayerOrder || gameState.activePlayerOrder.length === 0) { await checkAndMoveToFinalDiscard(); return; } const currentId = gameState.turnPlayerIndex; const currentIdx = gameState.activePlayerOrder.findIndex(p => p.id === currentId); let nextPlayer = null; for (let i = 1; i <= gameState.activePlayerOrder.length; i++) { const nextOrderIdx = (currentIdx + i) % gameState.activePlayerOrder.length; const potential = gameState.activePlayerOrder[nextOrderIdx]; if (potential && !potential.hasBid) { nextPlayer = potential; break; } } if (nextPlayer) { gameState.turnPlayerIndex = nextPlayer.id; if (!isSimulationRunning) logMessage(`Exchange turn to ${nextPlayer.name}.`); } else { if (!isSimulationRunning) logMessage("All active players completed exchange."); await checkAndMoveToFinalDiscard(); }}
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
    gameState.players.forEach(p => p.hasBid = false); 
    gameState.needsFinalDiscardPlayers = getActivePlayerOrder(gameState).filter(p => p.hand.length > 4); 
    if (gameState.needsFinalDiscardPlayers.length > 0) { 
        gameState.turnPlayerIndex = gameState.needsFinalDiscardPlayers[0].id; 
        if (!isSimulationRunning) logMessage(`Final Discard: ${gameState.needsFinalDiscardPlayers.map(p=>`${p.name}(${p.hand.length})`).join(', ')} need to discard.`); 
    } else { 
        if (!isSimulationRunning) logMessage("No final discards needed.");
        await checkAndMoveToPlayTricks(); 
    }
}

async function processFinalDiscardStep() { 
    const currentPlayer = gameState.players[gameState.turnPlayerIndex]; 
    if (!currentPlayer || !gameState.needsFinalDiscardPlayers.some(p=>p.id===currentPlayer.id) || currentPlayer.hasBid) { 
        await moveToNextFinalDiscarder(); 
        if (gameState.phase===GAME_PHASE.FINAL_DISCARD && !gameState.isWaitingForBidInput && !gameState.isAnimating && !isSimulationRunning) setTimeout(()=>nextStep(),10); 
        return; 
    } 
    const count = Math.max(0, currentPlayer.hand.length-4); 
    const strategy = getStrategyForPlayer(currentPlayer); 
    if (count<=0) { 
        if(!isSimulationRunning)currentPlayer.lastActionLog="Discarded 0 (Final)";
    } else { 
        if(!isSimulationRunning)logMessage(`${currentPlayer.name} discards ${count} down to 4.`); 
        const toDiscard = aiDecideCardToDiscard(currentPlayer, currentPlayer.hand, count, "final discard", gameState.trumpSuit, gameState, strategy, isSimulationRunning); 
        if(!toDiscard||toDiscard.length!==count){if(!isSimulationRunning)logMessage("AI final discard error.");gameState.phase=GAME_PHASE.ROUND_END;return;} 
        for(const card of toDiscard){
            if(!card)continue; 
            if(!isSimulationRunning){
                const el=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); 
                if(el)void el.offsetHeight; 
                const vis=el?Array.from(el.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(card.toString())):null; 
                let src=el||`#player-area-${currentPlayer.id}`; 
                if(vis){src=vis;vis.style.visibility='hidden';} else if(!isSimulationRunning)logMessage("Final Discard: visual not found"); 
                await animateCardMovement(src,'#talon-display',null,currentAnimationSpeed,{isDiscard:true});
            } 
            const rem=currentPlayer.removeCard(card); if(rem)gameState.discardPile.push(rem); 
            if(!isSimulationRunning)renderGame(gameState);
        } 
        if(!isSimulationRunning)currentPlayer.lastActionLog=`Discarded: ${toDiscard.map(c=>c.toString()).join(', ')} (Final)`;
    } 
    currentPlayer.hasBid=true; 
    await moveToNextFinalDiscarder();
}

async function moveToNextFinalDiscarder() { const next = gameState.needsFinalDiscardPlayers.find(p=>!p.hasBid); if(next){gameState.turnPlayerIndex=next.id; if(!isSimulationRunning)logMessage(`Final discard turn to ${next.name}.`);} else {if(!isSimulationRunning)logMessage("Final discards complete."); await checkAndMoveToPlayTricks();}}


async function checkAndMoveToPlayTricks() {
    if (!isSimulationRunning) logMessage("Checking if play phase can be skipped or who leads...");
    
    // Update activePlayerOrder first, as it's used to determine who is playing
    gameState.activePlayerOrder = getActivePlayerOrder(gameState); 
    
    // NEW: Re-check and set hasSauWeli for all *active* players based on their final 4-card hand
    if (gameState.trumpSuit) { // Only if trump is known
        gameState.activePlayerOrder.forEach(player => {
            const hadItBefore = player.hasSauWeli; // For logging/debugging if needed
            player.checkForSauWeli(gameState.trumpSuit); // This sets player.hasSauWeli

            // If hasSauWeli is now true, initialize/reset the aiPlan state for leading
            if (player.hasSauWeli) {
                if (!player.aiPlan) player.aiPlan = {};
                player.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_ACE';
                if (!isSimulationRunning && !hadItBefore) {
                    logMessage(`Player ${player.name} has Sau+Weli for trick play. AI Plan state set to READY_TO_LEAD_ACE.`);
                } else if (!isSimulationRunning && hadItBefore && player.aiPlan.sauWeliLeadState !== 'READY_TO_LEAD_ACE') {
                    // If they had it before but plan was disrupted, re-initialize
                    logMessage(`Player ${player.name} still has Sau+Weli. AI Plan state reset/confirmed to READY_TO_LEAD_ACE.`);
                }
            } else { // If they don't have SauWeli now
                if (player.aiPlan) player.aiPlan.sauWeliLeadState = null;
            }
        });
    } else {
        // No trump suit determined (should be rare at this stage unless game ended prematurely)
        gameState.players.forEach(p => {
             p.hasSauWeli = false;
             if(p.aiPlan) p.aiPlan.sauWeliLeadState = null;
        });
    }
    // END NEW hasSauWeli check

    gameState.players.forEach(p => p.hasBid = false); // Reset general 'hasBid' flag for playing turns

    if (gameState.activePlayerOrder.length === 1) {
        const lonePlayer = gameState.activePlayerOrder[0];
        if (!isSimulationRunning) logMessage(`${lonePlayer.name} is the only active player. Wins all 4 tricks.`);
        gameState.roundWinner = lonePlayer; 
        lonePlayer.tricksWonThisRound = 4;
        gameState.phase = GAME_PHASE.SCORING;
        gameState.turnPlayerIndex = -1;
        return; 
    } else if (gameState.activePlayerOrder.length === 0) { 
        if (gameState.sneaker) { 
            if (!isSimulationRunning) logMessage(`No active players remaining to play against Sneaker ${gameState.sneaker.name}. Scoring.`);
        } else {
            if (!isSimulationRunning) logMessage("No active players and no sneaker. Round ends (likely All Weiter or error).");
        }
        gameState.phase = GAME_PHASE.SCORING; 
        gameState.turnPlayerIndex = -1; 
        return;
    }
    
    let firstLeader = (gameState.sneaker && gameState.activePlayerOrder.some(p=>p.id===gameState.sneaker.id)) ? gameState.sneaker : gameState.activePlayerOrder[0];
    if (!isSimulationRunning) logMessage(`${firstLeader.name} leads the first trick.`); 
    gameState.turnPlayerIndex = firstLeader.id; 
    gameState.trickLeadPlayerIndex = firstLeader.id; 
    gameState.currentTrick = []; 
    gameState.phase = GAME_PHASE.PLAYING_TRICKS; 
}


async function processPlayCardStep() { const currentPlayer = gameState.players[gameState.turnPlayerIndex]; if (!currentPlayer || !gameState.activePlayerOrder.some(p=>p.id===currentPlayer.id)) { if(!isSimulationRunning)logMessage("Error: Invalid current player for play."); gameState.phase = gameState.currentTrick.length > 0 ? GAME_PHASE.TRICK_END : GAME_PHASE.ROUND_END; return; } if (currentPlayer.hand.length === 0) { if(!isSimulationRunning)logMessage(`${currentPlayer.name} has no cards.`); if(!isSimulationRunning)currentPlayer.lastActionLog="(No cards)"; currentPlayer.hasBid=true; moveToNextPlayerInTrick(); if(gameState.phase===GAME_PHASE.PLAYING_TRICKS && !gameState.isAnimating && !isSimulationRunning)setTimeout(()=>nextStep(),10); return; } if(!isSimulationRunning)logMessage(`Play turn for ${currentPlayer.name}. Trick: [${gameState.currentTrick.map(p=>p.card.toString()).join(', ')}]`); const validPlays = GameRules.getValidPlays(gameState, currentPlayer); if(validPlays.length===0){if(!isSimulationRunning)logMessage(`CRITICAL: No valid plays for ${currentPlayer.name}!`); gameState.phase=GAME_PHASE.ROUND_END;return;} const strategy = getStrategyForPlayer(currentPlayer); const aiCard = aiDecideCardToPlay(currentPlayer, validPlays, gameState, strategy, isSimulationRunning); let cardToPlay = validPlays.find(vc=>vc&&aiCard&&vc.key===aiCard.key)||validPlays[0]; if(!cardToPlay){if(!isSimulationRunning)logMessage(`CRITICAL: No card chosen for ${currentPlayer.name}!`); gameState.phase=GAME_PHASE.ROUND_END;return;} if(!isSimulationRunning){const handArea=document.querySelector(`#player-area-${currentPlayer.id} .player-hand`); if(handArea)void handArea.offsetHeight; let srcEl=handArea?Array.from(handArea.querySelectorAll('.card-image')).find(i=>i&&i.alt&&i.alt.startsWith(cardToPlay.toString())):null; let srcAnim=handArea||`#player-area-${currentPlayer.id}`; if(srcEl){srcAnim=srcEl;srcEl.style.visibility='hidden';}else console.warn("Play Card: visual not found"); const trickAreaEl=document.getElementById('trick-area'); await animateCardMovement(srcAnim,trickAreaEl,cardToPlay,currentAnimationSpeed,{isPlayingToTrick:true,revealAtEnd:false});} const removed=currentPlayer.removeCard(cardToPlay); if(removed){gameState.currentTrick.push({player:currentPlayer,card:cardToPlay}); if(!isSimulationRunning){logMessage(`${currentPlayer.name} played ${cardToPlay}`);currentPlayer.lastActionLog=`Played: ${cardToPlay}`;renderGame(gameState);} currentPlayer.hasBid=true;}else{if(!isSimulationRunning)logMessage("CRITICAL: Failed to remove card."); gameState.phase=GAME_PHASE.ROUND_END;return;} const expectedInTrick = getActivePlayerOrder(gameState).filter(p=>p.hand.length>0||gameState.currentTrick.some(play=>play.player.id===p.id)); if(gameState.currentTrick.length>=expectedInTrick.length)gameState.phase=GAME_PHASE.TRICK_END; else moveToNextPlayerInTrick();}
function moveToNextPlayerInTrick() { if (!gameState.activePlayerOrder || gameState.activePlayerOrder.length === 0) { gameState.phase = gameState.currentTrick.length > 0 ? GAME_PHASE.TRICK_END : GAME_PHASE.SCORING; return; } const lastId = gameState.turnPlayerIndex; const lastIdx = gameState.activePlayerOrder.findIndex(p=>p.id===lastId); if(lastIdx===-1){if(!isSimulationRunning)logMessage("Error finding last player."); gameState.phase=GAME_PHASE.TRICK_END;return;} let nextPlayer=null; for(let i=1;i<=gameState.activePlayerOrder.length;i++){const next=(lastIdx+i)%gameState.activePlayerOrder.length; const pot=gameState.activePlayerOrder[next]; if(pot&&!gameState.currentTrick.some(play=>play.player.id===pot.id)&&pot.hand.length>0){nextPlayer=pot;break;}} if(nextPlayer){gameState.turnPlayerIndex=nextPlayer.id;if(!isSimulationRunning)logMessage(`Play turn to ${nextPlayer.name}.`);} else gameState.phase=GAME_PHASE.TRICK_END;}

async function processTrickEndStep() { 
    if(!gameState.currentTrick || gameState.currentTrick.length === 0){ 
        const cardsLeft = getActivePlayerOrder(gameState).reduce((s,p)=>s+(p.hand?.length||0),0); 
        if(cardsLeft===0||gameState.tricksPlayedCount>=4)gameState.phase=GAME_PHASE.SCORING; 
        else {if(!isSimulationRunning)logMessage("Warning: Trick end with no cards.");gameState.phase=GAME_PHASE.SCORING;} 
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
    if (playThatLedTrick && playThatLedTrick.player.id === winner.id) { 
        const leader = winner;
        if (leader.aiPlan && leader.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_ACE' && playThatLedTrick.card.rank === 'A' && playThatLedTrick.card.suit === gameState.trumpSuit) {
            const weliStillInHand = leader.hand.find(c => c && c.rank === WELI_RANK);
            if (weliStillInHand) {
                leader.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_WELI';
                if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Ace and won. Ready to lead Weli.`);
            } else {
                leader.aiPlan.sauWeliLeadState = null; 
                leader.hasSauWeli = false; 
                 if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Ace and won, but Weli no longer in hand. Plan ended.`);
            }
        } else if (leader.aiPlan && leader.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_WELI' && playThatLedTrick.card.rank === WELI_RANK) {
            leader.aiPlan.sauWeliLeadState = 'COMPLETED'; 
            if (!isSimulationRunning) logMessage(`AI (${leader.name}): SauWeli plan: Led Weli and won. Plan completed.`);
        }
    } else if (playThatLedTrick && playThatLedTrick.player.aiPlan && playThatLedTrick.player.aiPlan.sauWeliLeadState) {
        if (!isSimulationRunning) logMessage(`AI (${playThatLedTrick.player.name}): SauWeli plan: Led with ${playThatLedTrick.card} but lost trick. Plan disrupted/ended.`);
        playThatLedTrick.player.aiPlan.sauWeliLeadState = null; 
        const stillHasAce = playThatLedTrick.player.hand.some(c=>c.rank === 'A' && c.suit === gameState.trumpSuit);
        const stillHasWeli = playThatLedTrick.player.hand.some(c=>c.rank === WELI_RANK);
        if (!stillHasAce || !stillHasWeli) playThatLedTrick.player.hasSauWeli = false;
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
    gameState.players.forEach(p=>p.hasBid=false); 
    if(gameState.tricksPlayedCount>=4){gameState.phase=GAME_PHASE.SCORING;gameState.turnPlayerIndex=-1;} 
    else {
        if(getActivePlayerOrder(gameState).some(p=>p.id===winner.id)){gameState.phase=GAME_PHASE.PLAYING_TRICKS;gameState.turnPlayerIndex=winner.id;gameState.trickLeadPlayerIndex=winner.id;}
        else{if(!isSimulationRunning)logMessage("Error: Trick winner not active.");gameState.phase=GAME_PHASE.SCORING;gameState.turnPlayerIndex=-1;}
    }
}

function processAllWeiterPenalty() { if (!isSimulationRunning) logMessage("Applying 'All Weiter' penalty."); const scores = GameRules.calculateAllWeiterScores(gameState, currentDealerAnte); gameState.players.forEach(player => { const scoreInfo = scores[player.id]; if (scoreInfo) { player.points += scoreInfo.points; if (!isSimulationRunning) player.lastActionLog = `All Weiter (${scoreInfo.points >= 0 ? '+' : ''}${scoreInfo.points.toFixed(1)})`; } else if (!isSimulationRunning) player.lastActionLog = `All Weiter (Error)`; }); gameState.phase = GAME_PHASE.ROUND_END; gameState.turnPlayerIndex = -1; if (!isSimulationRunning) gameState.lastActionLog = `Round ended: All Weiter.`; }
function processScoringStep() { if (!isSimulationRunning) logMessage("Calculating scores..."); let scores; try { scores = GameRules.calculateRoundScores(gameState, currentDealerAnte, currentMuasPenalty); } catch (error) { if (!isSimulationRunning) logMessage("Scoring error: " + error.message); gameState.phase = GAME_PHASE.ROUND_END; gameState.turnPlayerIndex = -1; return; } let summary = "Round scored: "; for (const player of gameState.players) { const info = scores[player.id]; if (info) { player.points += info.points; if (!isSimulationRunning) { let desc=(gameState.roundWinner&&player===gameState.roundWinner)?`Won Uncontested!`: (player.status===PLAYER_STATUS.ACTIVE_SNEAKER)?(info.tricks>=2?`Sneaker Success!`:`Sneaker Failed!`): (player.status===PLAYER_STATUS.ACTIVE_PLAYER)?(info.tricks>=1?`Player Success`:`Player Failed!`): (player.status===PLAYER_STATUS.FOLDED)?`Folded`:`(Inactive)`; player.lastActionLog = `${desc} (${info.points>=0?'+':''}${info.points.toFixed(1)})`; summary += `${player.name} ${player.lastActionLog}; `;}} else if(!isSimulationRunning){player.lastActionLog=`(Score Error)`; summary += `${player.name} (Error); `;}} gameState.phase = GAME_PHASE.ROUND_END; gameState.turnPlayerIndex = -1; if(!isSimulationRunning)gameState.lastActionLog = summary.trim();}

export async function nextStep() { if (!gameState) { logMessage("Error: gameState is null."); return; } if (gameState.isWaitingForBidInput) { logMessage("Waiting for user input..."); renderGame(gameState); return; } if (gameState.isAnimating) { logMessage("Animation in progress, please wait..."); return; } gameState.isAnimating = true; const btn = document.getElementById('next-step'); if (btn) btn.disabled = true; logMessage(`--- Executing Step: Current Phase [${gameState.phase}] ---`); try { switch (gameState.phase) { case GAME_PHASE.SETUP: case GAME_PHASE.ROUND_END: await startNewRound(); break; case GAME_PHASE.ANTE: processAnte(); break; case GAME_PHASE.DEALING: await processDealingStep(); break; case GAME_PHASE.DEALER_DISCARD: await processDealerDiscardStep(); break; case GAME_PHASE.BIDDING_STAGE_1: await processBiddingStep(GAME_PHASE.BIDDING_STAGE_1); break; case GAME_PHASE.RESOLVE_ODER: await processOderResolution(); break; case GAME_PHASE.BIDDING_STAGE_2: await processBiddingStep(GAME_PHASE.BIDDING_STAGE_2); break; case GAME_PHASE.EXCHANGE_PREP: await processOderDiscardStep(); break; case GAME_PHASE.EXCHANGE: await processExchangeStep(); break; case GAME_PHASE.FINAL_DISCARD: await processFinalDiscardStep(); break; case GAME_PHASE.PLAYING_TRICKS: await processPlayCardStep(); break; case GAME_PHASE.TRICK_END: await processTrickEndStep(); break;  case GAME_PHASE.ALL_WEITER_PENALTY: processAllWeiterPenalty(); break; case GAME_PHASE.SCORING: processScoringStep(); break; default: logMessage(`Error: Unknown game phase: ${gameState.phase}`); gameState.phase = GAME_PHASE.ROUND_END; } } catch (error) { logMessage(`!!! Runtime Error in phase ${gameState.phase}: ${error.message} !!!`); console.error("Error during phase execution:", gameState.phase, error.stack); gameState.phase = GAME_PHASE.ROUND_END; gameState.lastActionLog = `Error: ${error.message}`; } finally { gameState.isAnimating = false; if (btn) btn.disabled = gameState.isWaitingForBidInput; } if (!gameState.isWaitingForBidInput) { renderGame(gameState); const errEnd = gameState.phase === GAME_PHASE.ROUND_END && gameState.lastActionLog?.includes("Error"); if (gameState.phase !== GAME_PHASE.ROUND_END || !errEnd) logMessage(`--- Step Complete: Now Phase [${gameState.phase}] ---`); else if (errEnd) logMessage(`--- Round ended due to error. ---`); } else { renderGame(gameState); logMessage(`--- Paused for Input: Phase [${gameState.phase}] Player: ${gameState.players[gameState.turnPlayerIndex]?.name} ---`); } }
export async function handleUserBid(chosenBid) { if (!gameState || !gameState.isWaitingForBidInput) return; const player = gameState.players[gameState.turnPlayerIndex]; const valid = gameState.pendingValidBids; const stage = gameState.phase; if (!player) { gameState.isWaitingForBidInput = false; return; } logMessage(`User (${player.name}) selected bid: ${chosenBid}`); if (!valid.includes(chosenBid)) { renderGame(gameState); return; } gameState.isWaitingForBidInput = false; gameState.pendingValidBids = []; gameState.isAnimating = true; const btn = document.getElementById('next-step'); if (btn) btn.disabled = true; await _processChosenBid(player, chosenBid, stage, gameState); gameState.isAnimating = false; if (btn) btn.disabled = false; renderGame(gameState); const nextPlayer = gameState.players[gameState.turnPlayerIndex]; let pause = false; if (isManualBiddingMode && gameState.turnPlayerIndex !== -1 && nextPlayer && nextPlayer.id === 0) { if ((gameState.phase === GAME_PHASE.BIDDING_STAGE_1 || gameState.phase === GAME_PHASE.BIDDING_STAGE_2)) { let turnP = gameState.players[gameState.turnPlayerIndex]; if (turnP) { let needsAct = (gameState.phase === GAME_PHASE.BIDDING_STAGE_1) ? (!turnP.hasBid && turnP.status !== PLAYER_STATUS.FOLDED) : (turnP !== gameState.sneaker && turnP !== gameState.oderPlayer && !turnP.hasBid && turnP.status !== PLAYER_STATUS.FOLDED); if (needsAct) pause = true; } } } if (!pause && !gameState.isAnimating) { logMessage(`--- Bid Processed. Auto-advancing... ---`); setTimeout(() => nextStep(), 50); } else if (pause) { logMessage(`--- Bid Processed. Pausing for next manual input for P0. ---`); renderGame(gameState); } }

async function playFullGameSilently() {
    gameState.isWaitingForBidInput = false; gameState.isAnimating = false; 
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
        if (gameState.phase === phaseBefore && gameState.turnPlayerIndex === turnPlayerBefore && gameState.phase !== GAME_PHASE.ROUND_END && gameState.turnPlayerIndex !== -1) { gameState.phase = GAME_PHASE.ROUND_END; }
    }
    if (safetyBreak >= MAX_STEPS_PER_GAME) { if (gameState.phase !== GAME_PHASE.ROUND_END && gameState.phase !== GAME_PHASE.SCORING) processScoringStep(); gameState.phase = GAME_PHASE.ROUND_END; }
}

export async function runBatchSimulation(numGames, progressCallback) {
    isSimulationRunning = true;
    logMessage(`Starting batch simulation for ${numGames} games... (UI updates disabled)`);

    const aggregatedPlayerPoints = Array(PLAYER_COUNT).fill(0);
    const playerNames = gameState ? gameState.players.map(p => p.name) : Array(PLAYER_COUNT).fill(null).map((_,i) => `P${i}`);
    let gamesSuccessfullyCompleted = 0;
    const initialUiPlayerPoints = gameState ? gameState.players.map(p => p.points) : Array(PLAYER_COUNT).fill(0);

    for (let i = 0; i < numGames; i++) {
        initializeGame(true); 
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
             if(!isSimulationRunning) logMessage(`SIM: Completed ${i + 1} / ${numGames} games...`); // Only log if not in silent sim (edge case, should be true)
             else if ( (i+1) === numGames) logMessage(`SIM: Completed ${i + 1} / ${numGames} games...`); // Ensure final log even in sim
        }
    }

    isSimulationRunning = false; 
    logMessage(`Batch simulation finished. ${gamesSuccessfullyCompleted}/${numGames} games completed successfully.`);
    
    initializeGame(false); 
    if (gameState && initialUiPlayerPoints) {
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