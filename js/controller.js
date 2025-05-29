// js/controller.js

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

let currentStrategyConfig = {
    bidStage1: { minCompanionTrumpValueForSneak: "X", soloTrumpAceSneakChance: 0.3, minTrumpForOderMit: "9", alwaysSneakIfLastAndNoBid: true },
    bidStage2: { minTrumpValueToPlayWithSneaker: "9", lowTrumpPlayChanceWithSneaker: 0.3, minSuitValueForOderPlay: "U", playIfLastNoOneJoined: true },
    exchange: { maxTrumpValueForTrumpfPackerl: "9", considerSauIfPlanned: true }
};

// --- Configuration Setters ---
export function setDealerAnte(value) { currentDealerAnte = parseFloat(value); if(!isNaN(currentDealerAnte)) logMessage(`Dealer Ante: ${currentDealerAnte.toFixed(1)}`); else console.warn("Invalid Dealer Ante value:", value);}
export function setMuasPenalty(value) { currentMuasPenalty = parseFloat(value); if(!isNaN(currentMuasPenalty)) logMessage(`"Muas" Penalty: ${currentMuasPenalty.toFixed(1)}`);  else console.warn("Invalid Muas Penalty value:", value);}
export function updateStrategyParameter(category, parameterName, value) {
    if (!currentStrategyConfig[category]) {
        currentStrategyConfig[category] = {};
    }
    const numVal = parseFloat(value);
    if (!isNaN(numVal) && !RANKS.includes(String(value).toUpperCase()) && typeof value !== 'boolean') {
        currentStrategyConfig[category][parameterName] = numVal;
    } else {
        currentStrategyConfig[category][parameterName] = value;
    }
    logMessage(`Strategy: ${category}.${parameterName} = ${currentStrategyConfig[category][parameterName]}`);
}
export function setAnimationSpeed(speed) { currentAnimationSpeed = parseFloat(speed); if(!isNaN(currentAnimationSpeed)) logMessage(`Animation speed set to: ${currentAnimationSpeed.toFixed(1)}s`); else console.warn("Invalid Animation Speed value:", speed); }

// --- Initialization ---
export function initializeGame() {
    logMessage("Initializing New Game...");
    gameState = new GameState(PLAYER_COUNT);
    gameState.phase = GAME_PHASE.SETUP;
    gameState.isWaitingForBidInput = false;
    gameState.pendingValidBids = [];
    gameState.isAnimating = false;

    const manualToggle = document.getElementById('manual-mode-toggle');
    if (manualToggle) {
        isManualBiddingMode = manualToggle.checked;
        manualToggle.addEventListener('change', (event) => {
            isManualBiddingMode = event.target.checked;
            logMessage(`Manual Mode: ${isManualBiddingMode}`);
            if (gameState && gameState.isWaitingForBidInput) renderGame(gameState);
        });
    } else {
        isManualBiddingMode = false;
        console.warn("Manual mode toggle not found.");
    }

    logMessage(`Initial Settings -> Animation: ${currentAnimationSpeed.toFixed(1)}s, Ante: ${currentDealerAnte.toFixed(1)}, Muas: ${currentMuasPenalty.toFixed(1)}`);
    logMessage(`Initial Strategy: ${JSON.stringify(currentStrategyConfig)}`);
    renderGame(gameState);
    logMessage(`Game setup. Dealer: ${gameState.players[gameState.dealerIndex].name}. Click 'Next Step'`);
}


// --- Helper Functions (Defined before main phase processors that might use them indirectly) ---
function getActivePlayerOrder(gameState) {
    const active = gameState.getActivePlayers();
    if (!active || active.length === 0) return [];
    const forehandIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
    active.sort((a, b) => {
        const orderA = (a.id - forehandIndex + gameState.players.length) % gameState.players.length;
        const orderB = (b.id - forehandIndex + gameState.players.length) % gameState.players.length;
        return orderA - orderB;
    });
    return active;
}

async function replenishTalonIfNeeded() {
    if (gameState.talon.length === 0) {
        let cardsForNewTalon = [];
        if (gameState.discardPile && gameState.discardPile.length > 0) {
            cardsForNewTalon.push(...gameState.discardPile.filter(c => c instanceof Card));
            gameState.discardPile = [];
        }
        if (gameState.foldedPile && gameState.foldedPile.length > 0) {
            cardsForNewTalon.push(...gameState.foldedPile.filter(c => c instanceof Card));
            gameState.foldedPile = [];
        }

        if (cardsForNewTalon.length > 0) {
            gameState.talon = cardsForNewTalon;
            for (let k = gameState.talon.length - 1; k > 0; k--) {
                const j = Math.floor(Math.random() * (k + 1));
                [gameState.talon[k], gameState.talon[j]] = [gameState.talon[j], gameState.talon[k]];
            }
            logMessage(`Talon replenished and reshuffled. New Talon size: ${gameState.talon.length}`);
            return true;
        } else {
            logMessage("Talon empty. Discard/folded piles also empty. Cannot replenish.");
            return false;
        }
    }
    return true;
}

// From js/controller.js

async function _processChosenBid(player, chosenBid, stage, gameState) {
    player.currentBid = chosenBid;
    player.lastActionLog = `${chosenBid}`;
    player.hasBid = true;

    if (stage === GAME_PHASE.BIDDING_STAGE_1) {
        // ... (Stage 1 logic for Sneak, Oder, Weiter remains the same) ...
        switch (chosenBid) {
            case BID_OPTIONS.SNEAK:
                if (gameState.oderPlayer) { logMessage(`Sneak by ${player.name} overrides Oder by ${gameState.oderPlayer.name}.`); gameState.oderPlayer = null; gameState.oderType = null; }
                gameState.sneaker = player; player.status = PLAYER_STATUS.ACTIVE_SNEAKER;
                logMessage(`${player.name} bids SNEAK! Transitioning to BIDDING_STAGE_2.`);
                gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
                gameState.players.forEach(p => { if (p !== gameState.sneaker && p.status !== PLAYER_STATUS.FOLDED) p.hasBid = false; });
                gameState.turnPlayerIndex = gameState.nextPlayerIndex(player.id);
                await moveToNextBidder(gameState.phase);
                return;
            case BID_OPTIONS.ODER_MIT: case BID_OPTIONS.ODER_OHNE:
                if (gameState.sneaker) { logMessage(`Oder by ${player.name} ignored (Sneaker ${gameState.sneaker.name} exists).`); }
                else if (!gameState.oderPlayer) { gameState.oderPlayer = player; gameState.oderType = (chosenBid === BID_OPTIONS.ODER_MIT) ? 'mit' : 'ohne'; logMessage(`${player.name} bids ${chosenBid}.`);}
                else { logMessage(`Oder by ${player.name} ignored (Oder by ${gameState.oderPlayer.name} exists).`);}
                break;
            case BID_OPTIONS.WEITER: logMessage(`${player.name} says WEITER.`); break;
        }
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_1);
    } else { // BIDDING_STAGE_2
        switch (chosenBid) {
            case BID_OPTIONS.PLAY: logMessage(`${player.name} bids PLAY.`); player.status = PLAYER_STATUS.ACTIVE_PLAYER; break;
            case BID_OPTIONS.FOLD:
                logMessage(`${player.name} bids FOLD.`);
                player.status = PLAYER_STATUS.FOLDED;
                if (!gameState.foldedPile) gameState.foldedPile = [];

                if (player.hand.length > 0) {
                    logMessage(`Animating ${player.name}'s ${player.hand.length} cards to folded pile concurrently.`);
                    const playerHandElement = document.querySelector(`#player-area-${player.id} .player-hand`);
                    const cardsToFoldData = [...player.hand]; // Copy card data before modifying hand

                    const animationPromises = [];
                    let cardIndexForStagger = 0; // For optional stagger

                    // First, hide all visual cards that will be folded
                    if (playerHandElement) {
                        cardsToFoldData.forEach(cardData => {
                            if (!cardData) return;
                            const cardVisualElement = Array.from(playerHandElement.querySelectorAll('.card-image'))
                                .find(img => img && img.alt && img.alt.startsWith(cardData.toString()));
                            if (cardVisualElement) {
                                cardVisualElement.style.visibility = 'hidden';
                            }
                        });
                    }
                    
                    // Now, start all animations
                    for (const cardData of cardsToFoldData) {
                        if (!cardData) continue;
                        
                        // Since cards are hidden, source for animation can be general hand area
                        // or, if we want them to *originate* from their distinct spots before vanishing:
                        // We'd need to get their coordinates *before* hiding them all,
                        // but for a quick concurrent effect, animating from the hand center is often acceptable.
                        // Let's assume animating from their now-hidden individual slots is still preferred.
                        // The getElementCoordinates for a hidden element might be tricky or return 0,0.
                        // A safer bet for concurrent animation might be to get all coords first, then hide, then animate.
                        // However, the current animateCardMovement expects a selector OR coords.
                        // For simplicity and speed, let's animate from the general hand area for all cards if they are concurrently hidden.
                        // OR, let's try to get original positions if `cardVisualElement` was found,
                        // even if hidden, some browsers might still provide last known rect.

                        // Re-query for the visual element for its coordinates, even if hidden
                        // This relies on the browser still providing reasonable coordinates for hidden elements
                        // or that getElementCoordinates has a fallback for non-found/hidden elements.
                        const cardVisualElementForCoords = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                                .find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null;
                        
                        let sourceForAnimation = playerHandElement || `#player-area-${player.id}`; // Fallback
                        if (cardVisualElementForCoords) { // Use the specific (now hidden) card's selector/element for coords
                             sourceForAnimation = cardVisualElementForCoords;
                        } else {
                            logMessage(`Fold: Card visual for ${cardData.toString()} not found in ${player.name}'s hand. Animating from general hand area.`);
                        }

                        // Optional: Introduce a slight delay for staggering effect
                        // await new Promise(resolve => setTimeout(resolve, cardIndexForStagger * 50)); // 50ms stagger

                        const animationPromise = animateCardMovement(
                            sourceForAnimation, // This might be an issue if element is truly gone or coords are 0,0
                                                // A robust getElementCoordinates should handle fallbacks.
                            '#talon-display', 
                            null, 
                            currentAnimationSpeed, // Could make fold animation faster by default
                            { isDiscard: true }
                        );
                        animationPromises.push(animationPromise);
                        cardIndexForStagger++;
                    }

                    await Promise.all(animationPromises);

                    // Update data model AFTER all animations are conceptually done
                    gameState.foldedPile.push(...cardsToFoldData);
                    player.hand = []; // Clear hand in data model
                    renderGame(gameState); // Re-render to reflect the empty hand and updated talon/folded counts
                }
                break;
        }
        await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2);
    }
}


async function moveToNextBidder(stage) {
    let currentTurn = gameState.turnPlayerIndex;
    if (currentTurn === -1) { 
        if (stage === GAME_PHASE.BIDDING_STAGE_1) {
            currentTurn = gameState.nextPlayerIndex(gameState.dealerIndex);
        } else { 
            const initiator = gameState.sneaker || gameState.oderPlayer; 
            currentTurn = initiator ? gameState.nextPlayerIndex(initiator.id) : gameState.nextPlayerIndex(gameState.dealerIndex);
        }
    }

    for (let i = 0; i < gameState.players.length; i++) {
        const playerToCheck = gameState.players[currentTurn];
        let needsToAct = false;
        if (playerToCheck.status !== PLAYER_STATUS.FOLDED && !playerToCheck.hasBid) {
            if (stage === GAME_PHASE.BIDDING_STAGE_1) {
                needsToAct = true;
            } else { 
                if (playerToCheck !== gameState.sneaker && playerToCheck !== gameState.oderPlayer) {
                    needsToAct = true;
                }
            }
        }

        if (needsToAct) {
            gameState.turnPlayerIndex = currentTurn;
            logMessage(`moveToNextBidder: Turn is now ${gameState.players[currentTurn].name} for ${stage}`);
            return; 
        }
        currentTurn = gameState.nextPlayerIndex(currentTurn);
    }

    logMessage(`moveToNextBidder: No more players need to act in ${stage}. Resolving stage end.`);
    gameState.turnPlayerIndex = -1; 
    await resolveBiddingStageEnd(stage);
}

async function resolveBiddingStageEnd(stage) {
    logMessage(`Resolving end of ${stage}.`);
    if (stage === GAME_PHASE.BIDDING_STAGE_1) {
        if (gameState.sneaker) { 
            logMessage("Direct Sneak bid. Stage 1 resolved. Phase already set to Stage 2.");
            if(gameState.phase !== GAME_PHASE.BIDDING_STAGE_2) gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2);
        } else if (gameState.oderPlayer) { 
            logMessage(`Bid Stage 1 ended. Oder by ${gameState.oderPlayer.name}. Transitioning to Bid Stage 2.`);
            gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
            gameState.players.forEach(p => { 
                if (p !== gameState.oderPlayer && p.status !== PLAYER_STATUS.FOLDED) p.hasBid = false;
            });
            await moveToNextBidder(GAME_PHASE.BIDDING_STAGE_2);
        } else { 
            logMessage("All players bid Weiter in Stage 1!");
            gameState.phase = GAME_PHASE.ALL_WEITER_PENALTY;
        }
    } else { 
        gameState.players.forEach(p => p.hasBid = false); 

        if (gameState.oderPlayer) { 
            const activePlayersExcludingOder = gameState.getActivePlayers().filter(p => p !== gameState.oderPlayer);
            const oderPlayerStillIn = gameState.oderPlayer.status !== PLAYER_STATUS.FOLDED;
            const odererPlaysAlone = currentStrategyConfig.bidStage2.playIfLastNoOneJoined && activePlayersExcludingOder.length === 0;

            if (oderPlayerStillIn && (activePlayersExcludingOder.length > 0 || odererPlaysAlone)) {
                logMessage(`Oder by ${gameState.oderPlayer.name} proceeds. Resolving Oder...`);
                if (!gameState.sneaker) gameState.sneaker = gameState.oderPlayer; 
                gameState.sneaker.status = PLAYER_STATUS.ACTIVE_SNEAKER;
                gameState.phase = GAME_PHASE.RESOLVE_ODER;
            } else {
                logMessage(`Oder by ${gameState.oderPlayer.name} does not proceed.`);
                gameState.phase = GAME_PHASE.SCORING; 
            }
        } else if (gameState.sneaker) { 
            const activePlayers = gameState.getActivePlayers();
            if (activePlayers.length === 1 && activePlayers[0] === gameState.sneaker) {
                logMessage(`${gameState.sneaker.name} wins uncontested! Scoring...`);
                gameState.roundWinner = gameState.sneaker;
                gameState.phase = GAME_PHASE.SCORING;
            } else if (activePlayers.length > 0) {
                logMessage("Bidding Stage 2 complete (Sneaker game). Proceeding to Exchange.");
                gameState.activePlayerOrder = getActivePlayerOrder(gameState);
                if (gameState.activePlayerOrder.length === 0) { gameState.phase = GAME_PHASE.ROUND_END; return; } 
                gameState.phase = GAME_PHASE.EXCHANGE;
                gameState.turnPlayerIndex = gameState.sneaker.id; 
            } else { 
                logMessage("Bidding Stage 2 ended (Sneaker game) - No active players? Round Ends.");
                gameState.phase = GAME_PHASE.ROUND_END;
            }
        } else { 
            logMessage("Error: End of Bidding Stage 2 implies All Weiter.");
            gameState.phase = GAME_PHASE.ALL_WEITER_PENALTY;
        }
    }
}


// --- Main Phase Processing Functions ---
async function startNewRound() {
    logMessage("Starting new round...");
    logMessage(`--- Config: AnimSpeed=${currentAnimationSpeed.toFixed(1)}s, Ante=${currentDealerAnte.toFixed(1)}, Muas=${currentMuasPenalty.toFixed(1)} ---`);
    logMessage(`--- Strategy: ${JSON.stringify(currentStrategyConfig)} ---`);

    gameState.dealerIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
    gameState.players.forEach(p => p.resetRound());
    gameState.deck = new Deck();
    gameState.talon = []; gameState.discardPile = []; gameState.foldedPile = [];
    gameState.trumpCard = null; gameState.trumpSuit = null; gameState.originalTrumpCard = null;
    gameState.currentTrick = []; gameState.tricksPlayedCount = 0; gameState.activePlayerOrder = [];
    gameState.sneaker = null; gameState.oderPlayer = null; gameState.oderType = null;
    gameState.roundWinner = null; gameState.isAutoSneaker = false;
    gameState.needsOderDiscard = false;
    gameState.needsFinalDiscardPlayers = [];
    gameState.isWaitingForBidInput = false; gameState.pendingValidBids = [];
    gameState.turnPlayerIndex = -1;

    gameState.phase = GAME_PHASE.ANTE;
}

function processAnte() {
    const dealer = gameState.players[gameState.dealerIndex];
    logMessage(`${dealer.name} (Dealer) posts ${currentDealerAnte.toFixed(1)} Ante.`);
    gameState.phase = GAME_PHASE.DEALING;
    gameState.subPhase = 'deal_batch_1';
}

async function processDealingStep() {
    const dealerIndex = gameState.dealerIndex;
    const playerCount = gameState.players.length;
    const talonCoords = getElementCoordinates('#talon-display');

    if (gameState.subPhase === 'deal_batch_1') {
        logMessage("Dealing first 2 cards...");
        for (let c = 0; c < 2; c++) {
            for (let i = 0; i < playerCount; i++) {
                const playerIndex = (dealerIndex + 1 + i) % playerCount;
                const player = gameState.players[playerIndex];
                if (gameState.deck.isEmpty()) { logMessage("Deck empty during deal batch 1."); break; }
                await animateCardMovement(
                    talonCoords,
                    `#player-area-${playerIndex} .player-hand`, 
                    null, 
                    currentAnimationSpeed,
                    { isDealing: true, cardIndexInHand: player.hand.length }
                );
                player.addCards(gameState.deck.deal());
                renderGame(gameState);
            }
            if (gameState.deck.isEmpty()) break;
        }
        gameState.subPhase = 'turn_trump';
    } else if (gameState.subPhase === 'turn_trump') {
        logMessage("Turning trump card...");
        if (gameState.deck.isEmpty()) { logMessage("Deck empty before turning trump!"); gameState.phase = GAME_PHASE.ROUND_END; return; }

        let turnedCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; 
        await animateCardMovement(
            talonCoords,
            `#player-area-${dealerIndex} .player-hand`, 
            turnedCardData, 
            currentAnimationSpeed,
            { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length }
        );
        turnedCardData = gameState.deck.deal(); 
        gameState.originalTrumpCard = turnedCardData; 
        gameState.players[dealerIndex].addCards(turnedCardData); 

        if (turnedCardData.rank === 'A') {
            gameState.isAutoSneaker = true; gameState.trumpCard = turnedCardData; gameState.trumpSuit = turnedCardData.suit;
        } else if (turnedCardData.rank === WELI_RANK) {
            if (gameState.deck.isEmpty()) { logMessage("Deck empty for second card after Weli!"); gameState.phase = GAME_PHASE.ROUND_END; return; }
            let nextCardData = gameState.deck.cards[gameState.deck.cards.length - 1]; 
            await animateCardMovement(talonCoords, `#player-area-${dealerIndex} .player-hand`, nextCardData, currentAnimationSpeed, { isDealing: true, revealAtEnd: true, cardIndexInHand: gameState.players[dealerIndex].hand.length });
            nextCardData = gameState.deck.deal();
            gameState.trumpCard = nextCardData; gameState.trumpSuit = nextCardData.suit;
            gameState.players[dealerIndex].addCards(nextCardData);
        } else {
            gameState.trumpCard = turnedCardData; gameState.trumpSuit = turnedCardData.suit;
        }
        renderGame(gameState); 
        gameState.subPhase = 'deal_batch_2';
    } else if (gameState.subPhase === 'deal_batch_2') {
        logMessage("Dealing second 2 cards...");
        for (let c = 0; c < 2; c++) {
            for (let i = 0; i < playerCount; i++) {
                const playerIndex = (dealerIndex + 1 + i) % playerCount;
                const player = gameState.players[playerIndex];
                if (gameState.deck.isEmpty()) { logMessage("Deck empty during deal batch 2."); break; }
                await animateCardMovement(talonCoords, `#player-area-${playerIndex} .player-hand`, null, currentAnimationSpeed, { isDealing: true, cardIndexInHand: player.hand.length });
                player.addCards(gameState.deck.deal());
                renderGame(gameState);
            }
            if (gameState.deck.isEmpty()) break;
        }
        gameState.talon = gameState.deck.cards; 
        logMessage(`Dealing complete. Talon: ${gameState.talon.length}`);
        gameState.phase = GAME_PHASE.DEALER_DISCARD;
        gameState.subPhase = null;
    }
}

async function processDealerDiscardStep() {
    const dealer = gameState.players[gameState.dealerIndex];
    const actualDiscardsNeeded = Math.max(0, dealer.hand.length - 4);

    if (actualDiscardsNeeded > 0) {
        logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards, needs to discard ${actualDiscardsNeeded}.`);
        const cardsToDiscard = aiDecideCardToDiscard(dealer, dealer.hand, actualDiscardsNeeded, "dealer discard", gameState.trumpSuit, gameState, currentStrategyConfig);
        if (!cardsToDiscard || cardsToDiscard.length !== actualDiscardsNeeded) { logMessage("AI dealer discard error."); gameState.phase = GAME_PHASE.ROUND_END; return; }

        for (const card of cardsToDiscard) {
            if (!card) continue;
            const playerHandElement = document.querySelector(`#player-area-${dealer.id} .player-hand`);
            if (playerHandElement) void playerHandElement.offsetHeight; 

            const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                .find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;

            let sourceForAnimation = playerHandElement || `#player-area-${dealer.id}`;
            if (cardVisualElement) {
                sourceForAnimation = cardVisualElement;
                cardVisualElement.style.visibility = 'hidden';
            } else {
                 logMessage(`Dealer Discard: Card visual for ${card.toString()} not found in ${dealer.name}'s hand. Animating from general hand area.`);
            }
            
            await animateCardMovement(
                sourceForAnimation, 
                '#talon-display', 
                null, 
                currentAnimationSpeed,
                { isDiscard: true }
            );
            const removed = dealer.removeCard(card); 
            if (removed) gameState.discardPile.push(removed);
            renderGame(gameState); 
        }
        dealer.lastActionLog = `Discarded: ${cardsToDiscard.map(c => c.toString()).join(', ')}`;
    } else {
        logMessage(`Dealer (${dealer.name}) has ${dealer.hand.length} cards. No discard needed.`);
    }

    if (gameState.isAutoSneaker) {
        gameState.sneaker = dealer; gameState.sneaker.status = PLAYER_STATUS.ACTIVE_SNEAKER;
        gameState.phase = GAME_PHASE.BIDDING_STAGE_2;
        gameState.turnPlayerIndex = gameState.nextPlayerIndex(gameState.dealerIndex);
        gameState.players.forEach(p => { p.hasBid = (p === gameState.sneaker || p.status === PLAYER_STATUS.FOLDED); });
        await moveToNextBidder(gameState.phase);
    } else {
        gameState.phase = GAME_PHASE.BIDDING_STAGE_1;
        gameState.turnPlayerIndex = gameState.nextPlayerIndex(gameState.dealerIndex); 
        gameState.players.forEach(p => p.hasBid = false);
    }
}

async function processBiddingStep(stage) {
    if (gameState.turnPlayerIndex === -1) {
        return;
    }

    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer) { logMessage(`Error: No current player for bidding stage ${stage}.`); await resolveBiddingStageEnd(stage); return; }

    let needsToAct = false;
    if (currentPlayer.status !== PLAYER_STATUS.FOLDED && !currentPlayer.hasBid) {
        if (stage === GAME_PHASE.BIDDING_STAGE_1) {
            needsToAct = true;
        } else { 
            if (currentPlayer !== gameState.sneaker && currentPlayer !== gameState.oderPlayer) {
                needsToAct = true;
            }
        }
    }

    if (!needsToAct) {
        logMessage(`Player ${currentPlayer.name} does not need to act in ${stage}. Moving to next bidder.`);
        await moveToNextBidder(stage);
        return;
    }

    logMessage(`Bid turn for ${currentPlayer.name} in ${stage}.`);
    const validBids = GameRules.getValidBids(gameState); 
    if (validBids.length === 0) {
        logMessage(`No valid bids for ${currentPlayer.name}. Auto-folding.`);
        await _processChosenBid(currentPlayer, BID_OPTIONS.FOLD, stage, gameState);
        return;
    }

    if (isManualBiddingMode) {
        logMessage(`Requesting manual bid from ${currentPlayer.name}...`);
        gameState.pendingValidBids = validBids;
        gameState.isWaitingForBidInput = true;
    } else {
        logMessage(`Getting AI bid for ${currentPlayer.name}...`);
        const aiChosenBid = aiDecideBid(currentPlayer, validBids, gameState, currentStrategyConfig);
        await _processChosenBid(currentPlayer, validBids.includes(aiChosenBid) ? aiChosenBid : validBids[0], stage, gameState);
    }
}

async function processOderResolution() {
    if (!gameState.oderPlayer || !gameState.sneaker || gameState.oderPlayer !== gameState.sneaker) { 
        logMessage("Oder resolution state error: No Oder player or Sneaker mismatch."); 
        gameState.phase = GAME_PHASE.ROUND_END; 
        return; 
    }
    const sneakerPlayer = gameState.sneaker; 
    logMessage(`Resolving Oder (${gameState.oderType}) for ${sneakerPlayer.name}. Drawing new trump...`);
    const talonCoords = getElementCoordinates('#talon-display');
    const revealSpot = getElementCoordinates('#game-info .game-info-content');

    let newTrumpCardDeterminer = null;
    let drawnWeliAsFirstCard = null;
    let newTrumpSuit = null;
    const originalTrumpSuitIfAny = gameState.originalTrumpCard?.suit;
    let cardsDrawnThisProcess = [];
    let success = false;
    let drawAttempts = 0;
    const maxDrawAttempts = (gameState.talon?.length || 0) + 20; 

    while (drawAttempts < maxDrawAttempts && !success) {
        drawAttempts++;
        if (gameState.talon.length === 0) {
            if (!(await replenishTalonIfNeeded())) {
                logMessage("Oder fail: Talon empty, cannot replenish.");
                break; 
            }
            renderGame(gameState); 
        }
        if (gameState.talon.length === 0) { 
            logMessage("Oder fail: Talon still empty after replenish attempt."); 
            break; 
        }

        let cardDrawnData = gameState.talon[gameState.talon.length - 1]; 
        await animateCardMovement(talonCoords, revealSpot, cardDrawnData, currentAnimationSpeed, { revealAtEnd: true });
        cardDrawnData = gameState.talon.pop(); 
        if (!cardDrawnData) { 
            logMessage("Oder error: Popped null card from talon."); 
            break; 
        }
        cardsDrawnThisProcess.push(cardDrawnData);
        renderGame(gameState); 

        if (!drawnWeliAsFirstCard && cardDrawnData.rank === WELI_RANK) {
            drawnWeliAsFirstCard = cardDrawnData;
            logMessage(`Weli drawn by ${sneakerPlayer.name}. Will draw another card for trump determination.`);
            if (gameState.talon.length === 0 && !(await replenishTalonIfNeeded())) {
                logMessage("Oder fail: Talon empty after drawing Weli, cannot draw trump determiner.");
                success = false; 
                break; 
            }
            renderGame(gameState); 
            continue; 
        } else {
            newTrumpCardDeterminer = cardDrawnData;
            
            if (gameState.oderType === 'mit') {
                newTrumpSuit = newTrumpCardDeterminer.suit;
                success = true;
                logMessage(`Oder Mit: ${newTrumpCardDeterminer} (drawn by ${sneakerPlayer.name}) sets trump to ${newTrumpSuit}.`);
            } else { 
                if (!originalTrumpSuitIfAny) {
                    logMessage("Oder Ohne error: No original trump suit defined for comparison.");
                    success = false; 
                    break; 
                }
                if (newTrumpCardDeterminer.suit !== originalTrumpSuitIfAny) {
                    newTrumpSuit = newTrumpCardDeterminer.suit;
                    success = true;
                    logMessage(`Oder Ohne: ${newTrumpCardDeterminer} (drawn by ${sneakerPlayer.name}) sets trump to ${newTrumpSuit} (different from original ${originalTrumpSuitIfAny}).`);
                } else {
                    logMessage(`Oder Ohne: Drew ${newTrumpCardDeterminer} (suit ${newTrumpCardDeterminer.suit} matches original ${originalTrumpSuitIfAny}). Discarding and re-drawing.`);
                    gameState.discardPile.push(newTrumpCardDeterminer);
                    newTrumpCardDeterminer = null; 
                }
            }
        }
    } 

    if (!success || !newTrumpCardDeterminer) { 
        logMessage(`Oder resolution failed for ${sneakerPlayer.name}.`);
        cardsDrawnThisProcess.forEach(card => { 
            if (card && card !== drawnWeliAsFirstCard && card !== newTrumpCardDeterminer) { 
                if (!gameState.discardPile.some(dp => dp.key === card.key)) {
                    gameState.discardPile.push(card);
                }
            }
        });
        if (drawnWeliAsFirstCard && !success) { 
             if (!gameState.discardPile.some(dp => dp.key === drawnWeliAsFirstCard.key)) {
                 gameState.discardPile.push(drawnWeliAsFirstCard);
             }
        }
        if (newTrumpCardDeterminer && !success) { 
             if (!gameState.discardPile.some(dp => dp.key === newTrumpCardDeterminer.key)) {
                 gameState.discardPile.push(newTrumpCardDeterminer);
             }
        }
        
        gameState.phase = GAME_PHASE.SCORING; 
        gameState.oderPlayer = null; 
        gameState.oderType = null;
        return;
    }

    gameState.trumpCard = newTrumpCardDeterminer; 
    gameState.trumpSuit = newTrumpSuit;
    const sneakerHandCoords = getElementCoordinates(`#player-area-${sneakerPlayer.id} .player-hand`);

    await animateCardMovement(revealSpot, sneakerHandCoords, newTrumpCardDeterminer, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length });
    sneakerPlayer.addCards(newTrumpCardDeterminer);
    renderGame(gameState); 

    if (drawnWeliAsFirstCard) {
        await animateCardMovement(revealSpot, sneakerHandCoords, drawnWeliAsFirstCard, currentAnimationSpeed, { isDealing: true, cardIndexInHand: sneakerPlayer.hand.length });
        sneakerPlayer.addCards(drawnWeliAsFirstCard);
        renderGame(gameState); 
    }
    
    gameState.needsOderDiscard = (sneakerPlayer.hand.length > 4);
    
    cardsDrawnThisProcess.forEach(c => {
        if (c && c.key !== newTrumpCardDeterminer.key && (!drawnWeliAsFirstCard || c.key !== drawnWeliAsFirstCard.key)) {
            if (!gameState.discardPile.some(dp => dp.key === c.key)) {
                 gameState.discardPile.push(c);
            }
        }
    });
    
    gameState.oderPlayer = null; 
    gameState.oderType = null;

    gameState.activePlayerOrder = getActivePlayerOrder(gameState); 
    if (gameState.needsOderDiscard) {
        gameState.phase = GAME_PHASE.EXCHANGE_PREP;
        gameState.turnPlayerIndex = sneakerPlayer.id;
    } else {
        gameState.phase = GAME_PHASE.EXCHANGE;
        if (gameState.activePlayerOrder.length > 0) {
            gameState.turnPlayerIndex = (sneakerPlayer && gameState.activePlayerOrder.some(p => p.id === sneakerPlayer.id)) 
                                        ? sneakerPlayer.id 
                                        : gameState.activePlayerOrder[0].id;
        } else {
            gameState.phase = GAME_PHASE.SCORING; 
        }
    }
}

async function processOderDiscardStep() {
    if (gameState.needsOderDiscard && gameState.sneaker && gameState.turnPlayerIndex === gameState.sneaker.id) {
        const discardCount = Math.max(0, gameState.sneaker.hand.length - 4);
        if (discardCount > 0) {
            logMessage(`Sneaker (${gameState.sneaker.name}, from Oder) must discard ${discardCount}.`);
            const cardsToDiscard = aiDecideCardToDiscard(gameState.sneaker, gameState.sneaker.hand, discardCount, "Oder discard (EXCHANGE_PREP)", gameState.trumpSuit, gameState, currentStrategyConfig);
            if (!cardsToDiscard || cardsToDiscard.length !== discardCount) { logMessage("AI Oder discard error."); gameState.phase = GAME_PHASE.ROUND_END; return; }
            
            for (const card of cardsToDiscard) {
                if (!card) continue;
                const playerHandElement = document.querySelector(`#player-area-${gameState.sneaker.id} .player-hand`);
                if (playerHandElement) void playerHandElement.offsetHeight; 
                
                const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                    .find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;
                
                let sourceForAnimation = playerHandElement || `#player-area-${gameState.sneaker.id}`;
                if (cardVisualElement) {
                    sourceForAnimation = cardVisualElement;
                    cardVisualElement.style.visibility = 'hidden';
                } else {
                     logMessage(`Oder Discard: Card visual for ${card.toString()} not found in ${gameState.sneaker.name}'s hand. Animating from general area.`);
                }

                await animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, {isDiscard:true});
                const removed = gameState.sneaker.removeCard(card); if (removed) gameState.discardPile.push(removed);
                renderGame(gameState);
            }
            gameState.sneaker.lastActionLog = `Discarded ${discardCount} (Oder Prep)`;
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
    if (!currentPlayer || !gameState.activePlayerOrder || !gameState.activePlayerOrder.some(p => p.id === currentPlayer.id) || currentPlayer.hasBid) {
        await moveToNextExchanger();
        if (gameState.phase === GAME_PHASE.EXCHANGE && !gameState.isWaitingForBidInput && !gameState.isAnimating) { setTimeout(() => nextStep(), 10); }
        return;
    }
    logMessage(`Exchange turn for ${currentPlayer.name}.`);
    if (gameState.trumpSuit === null) { logMessage("CRITICAL: Trump null in exchange!"); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const validOptions = GameRules.getValidExchangeOptions(currentPlayer, gameState.trumpSuit);
    const decision = aiDecideExchange(currentPlayer, validOptions, gameState.trumpSuit, gameState, currentStrategyConfig);
    if (!decision || !decision.type || !validOptions.some(opt => opt.type === decision.type)) {
        logMessage(`AI Error: Invalid exchange decision for ${currentPlayer.name}. Defaulting to Standard, discard 0.`);
        decision.type = EXCHANGE_TYPE.STANDARD;
        decision.cardsToDiscard = [];
    }
    currentPlayer.exchangeAction = decision.type;
    currentPlayer.hasBid = true; 

    const isPackerl = (decision.type === EXCHANGE_TYPE.TRUMPF_PACKERL || decision.type === EXCHANGE_TYPE.NORMAL_PACKERL);
    const isSau = (decision.type === EXCHANGE_TYPE.SAU);
    const talonCoords = getElementCoordinates('#talon-display'); 

    if (isPackerl) {
        logMessage(`${currentPlayer.name} chose ${decision.type}. Discarding entire hand.`);
        const currentHandCardsData = [...currentPlayer.hand]; 

        for(const cardData of currentHandCardsData) {
            if (!cardData) continue;
            const playerHandElement = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
            if (playerHandElement) void playerHandElement.offsetHeight;

            const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                .find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null;

            let sourceForAnimation = playerHandElement || `#player-area-${currentPlayer.id}`;
            if (cardVisualElement) {
                sourceForAnimation = cardVisualElement;
                cardVisualElement.style.visibility = 'hidden';
            } else {
                logMessage(`Packerl Discard: Card visual for ${cardData.toString()} not found in ${currentPlayer.name}'s hand. Animating from general area.`);
            }
            await animateCardMovement(sourceForAnimation, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
        }
        gameState.discardPile.push(...currentHandCardsData.filter(c => c)); 
        currentPlayer.hand = []; 
        renderGame(gameState); 

        await drawCardsForPackerl(currentPlayer, decision.type); 

        if (currentPlayer.hand.length > 4) {
            const toDiscardCount = currentPlayer.hand.length - 4;
            logMessage(`${currentPlayer.name} (Packerl) must discard ${toDiscardCount}.`);
            const finalDiscardsData = aiDecideCardToDiscard(currentPlayer, currentPlayer.hand, toDiscardCount, "Packerl final", gameState.trumpSuit, gameState, currentStrategyConfig);

            for(const cardData of finalDiscardsData) {
                 if (!cardData) continue;
                 const playerHandElement = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                 if (playerHandElement) void playerHandElement.offsetHeight;

                 const cardVisual = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                    .find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null;
                
                 let sourceForAnimation = playerHandElement || `#player-area-${currentPlayer.id}`;
                 if (cardVisual) {
                    sourceForAnimation = cardVisual;
                    cardVisual.style.visibility = 'hidden';
                 } else {
                    logMessage(`Packerl Final Discard: Card visual for ${cardData.toString()} not found in ${currentPlayer.name}'s hand. Animating from general area.`);
                 }
                 await animateCardMovement(sourceForAnimation, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
                 const rem = currentPlayer.removeCard(cardData); if(rem) gameState.discardPile.push(rem);
                 renderGame(gameState);
            }
        }
        currentPlayer.lastActionLog = `${decision.type}, kept ${currentPlayer.hand.length}.`;

    } else if (isSau) {
        logMessage(`${currentPlayer.name} chose ${EXCHANGE_TYPE.SAU}.`);
        const trumpAce = currentPlayer.hand.find(c=> c && c.rank === 'A' && c.suit === gameState.trumpSuit);
        if (!trumpAce) { logMessage("SAU Error: No Trump Ace!"); currentPlayer.lastActionLog = `SAU Error!`; }
        else {
            const cardsToDiscardForSauData = currentPlayer.hand.filter(c => c && c.key !== trumpAce.key);

            for(const cardData of cardsToDiscardForSauData) {
                if (!cardData) continue;
                const playerHandElement = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
                if (playerHandElement) void playerHandElement.offsetHeight;
                
                const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                    .find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null;
                
                let sourceForAnimation = playerHandElement || `#player-area-${currentPlayer.id}`;
                if (cardVisualElement) {
                    sourceForAnimation = cardVisualElement;
                    cardVisualElement.style.visibility = 'hidden';
                } else {
                    logMessage(`Sau Discard: Card visual for ${cardData.toString()} not found in ${currentPlayer.name}'s hand. Animating from general area.`);
                }
                await animateCardMovement(sourceForAnimation, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
            }
            gameState.discardPile.push(...cardsToDiscardForSauData.filter(c => c)); 
            currentPlayer.hand = [trumpAce]; 
            renderGame(gameState); 

            await drawCardsForPlayer(currentPlayer, 4); 
            currentPlayer.lastActionLog = `SAU, kept ${currentPlayer.hand.length}.`;
        }
    } else { // Standard Exchange
        const cardsToDiscardData = decision.cardsToDiscard ? [...decision.cardsToDiscard.filter(c=>c)] : []; 
        logMessage(`${currentPlayer.name} Standard Exchange, discarding ${cardsToDiscardData.length}.`);

        for(const cardData of cardsToDiscardData) {
            const playerHandElement = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
            if (playerHandElement) void playerHandElement.offsetHeight;

            const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                .find(img => img && img.alt && img.alt.startsWith(cardData.toString())) : null;

            let sourceForAnimation = playerHandElement || `#player-area-${currentPlayer.id}`;
            if (cardVisualElement) {
                sourceForAnimation = cardVisualElement;
                cardVisualElement.style.visibility = 'hidden';
            } else {
                logMessage(`Standard Discard: Card visual for ${cardData.toString()} not found in ${currentPlayer.name}'s hand. Animating from general area.`);
            }
            await animateCardMovement(sourceForAnimation, talonCoords, null, currentAnimationSpeed, {isDiscard:true});
            const rem = currentPlayer.removeCard(cardData); 
            if(rem) gameState.discardPile.push(rem);      
            renderGame(gameState); 
        }
        
        const cardsToDrawCount = cardsToDiscardData.length;
        if (cardsToDrawCount > 0) {
            await drawCardsForPlayer(currentPlayer, cardsToDrawCount); 
        }
        currentPlayer.lastActionLog = `Exchanged, discarded ${cardsToDrawCount}.`;
    }
    await moveToNextExchanger();
}

async function drawCardsForPackerl(player, packerlType) {
    logMessage(`--- Starting ${packerlType} for ${player.name} ---`);
    const talonCoords = getElementCoordinates('#talon-display');
    const playerHandCoords = getElementCoordinates(`#player-area-${player.id} .player-hand`);
    
    const initialDrawCount = (packerlType === EXCHANGE_TYPE.TRUMPF_PACKERL) ? 5 : 4;
    logMessage(`${player.name} drawing ${initialDrawCount} cards face-down for ${packerlType}.`);

    for (let i = 0; i < initialDrawCount; i++) {
        if (! await replenishTalonIfNeeded()) { logMessage("Packerl draw fail: No talon for initial draw."); break; }
        renderGame(gameState); 
        if (gameState.talon.length === 0) { logMessage("Packerl draw fail: Talon empty during initial draw."); break; }
        
        await animateCardMovement(
            talonCoords, 
            playerHandCoords, 
            null, 
            currentAnimationSpeed, 
            { isDealing: true, cardIndexInHand: player.hand.length }
        );
        const actualCardDrawn = gameState.talon.pop(); 
        if(actualCardDrawn) player.addCards(actualCardDrawn); 
        renderGame(gameState);
    }

    let faceUpDraws = 0; 
    const MAX_FACE_UP_DRAWS_AFTER_INITIAL = 20; 

    do { 
        faceUpDraws++;
        if (! await replenishTalonIfNeeded()) { logMessage("Packerl face-up draw fail: No talon."); break; }
        renderGame(gameState); 
        if (gameState.talon.length === 0) { logMessage("Packerl face-up draw fail: Talon empty."); break; }
        
        const nextCardData = gameState.talon[gameState.talon.length - 1]; 
        await animateCardMovement(
            talonCoords, 
            playerHandCoords, 
            nextCardData, 
            currentAnimationSpeed, 
            { isDealing: true, revealAtEnd: true, cardIndexInHand: player.hand.length }
        );
        const actualCard = gameState.talon.pop(); 
        if (actualCard) player.addCards(actualCard); 
        renderGame(gameState);

        if (!actualCard || (! (actualCard.suit === gameState.trumpSuit || actualCard.rank === WELI_RANK))) { 
            logMessage(actualCard ? `Card ${actualCard} is NOT Trump - Stopping Packerl face-up draws.` : "No card drawn for Packerl (face-up)."); 
            break; 
        } else { 
            logMessage(`Card ${actualCard} is Trump - Keeping, drawing again for Packerl (face-up).`);
        }
        if (faceUpDraws >= MAX_FACE_UP_DRAWS_AFTER_INITIAL) {
            logMessage("Max face-up draws reached for Packerl.");
            break;
        }
    } while (true); 

    logMessage(`--- ${packerlType} for ${player.name} Complete. Hand: ${player.hand.length} ---`);
}

async function drawCardsForPlayer(player, count) {
    logMessage(`${player.name} needs ${count} card(s).`);
    const talonCoords = getElementCoordinates('#talon-display');
    const playerHandCoords = getElementCoordinates(`#player-area-${player.id} .player-hand`);
    for (let i = 0; i < count; i++) {
        if (! await replenishTalonIfNeeded()) { logMessage("Draw fail: No talon."); break; }
        renderGame(gameState); 
        if (gameState.talon.length === 0) { logMessage("Draw fail: Talon empty."); break; }
        await animateCardMovement(talonCoords, playerHandCoords, null, currentAnimationSpeed, {isDealing:true, cardIndexInHand: player.hand.length});
        const actualCardDrawn = gameState.talon.pop(); 
        if (actualCardDrawn) player.addCards(actualCardDrawn); 
        renderGame(gameState);
    }
}

async function moveToNextExchanger() {
    if (!gameState.activePlayerOrder || gameState.activePlayerOrder.length === 0) { await checkAndMoveToFinalDiscard(); return; }
    const currentPlayerId = gameState.turnPlayerIndex; 
    const currentActiveIndex = gameState.activePlayerOrder.findIndex(p => p.id === currentPlayerId); 
    let nextPlayerToExchange = null;
    for (let i = 1; i <= gameState.activePlayerOrder.length; i++) {
         const nextIndexInOrder = (currentActiveIndex + i) % gameState.activePlayerOrder.length;
         const potentialNextPlayer = gameState.activePlayerOrder[nextIndexInOrder];
         if (potentialNextPlayer && !potentialNextPlayer.hasBid) { 
             nextPlayerToExchange = potentialNextPlayer; 
             break; 
         }
    }
    if (nextPlayerToExchange) { 
        gameState.turnPlayerIndex = nextPlayerToExchange.id; 
        logMessage(`Exchange turn to ${nextPlayerToExchange.name}.`); 
    } else { 
        logMessage("All active players completed exchange."); 
        await checkAndMoveToFinalDiscard(); 
    }
}

async function checkAndMoveToFinalDiscard() {
    logMessage("Exchange phase complete. Checking final discards...");
    if (gameState && gameState.trumpSuit) { 
        gameState.getActivePlayers().forEach(player => player.checkForSauWeli(gameState.trumpSuit)); 
    } else { 
        logMessage("Cannot check SauWeli: No trump or gameState."); 
        gameState?.players.forEach(p => p.hasSauWeli = false); 
    }

    gameState.phase = GAME_PHASE.FINAL_DISCARD; 
    gameState.players.forEach(p => p.hasBid = false); 
    gameState.needsFinalDiscardPlayers = gameState.getActivePlayers().filter(p => p.hand.length > 4);

    if (gameState.needsFinalDiscardPlayers.length > 0) {
        if (gameState.activePlayerOrder && gameState.activePlayerOrder.length > 0) {
            gameState.needsFinalDiscardPlayers.sort((a, b) => gameState.activePlayerOrder.findIndex(p => p.id === a.id) - gameState.activePlayerOrder.findIndex(p => p.id === b.id));
        } else { 
            gameState.needsFinalDiscardPlayers.sort((a, b) => a.id - b.id); 
        }
        gameState.turnPlayerIndex = gameState.needsFinalDiscardPlayers[0].id;
        logMessage(`Final Discard: ${gameState.needsFinalDiscardPlayers.map(p=>`${p.name}(${p.hand.length})`).join(', ')} need to discard.`);
    } else {
        logMessage("No final discards needed.");
        await checkAndMoveToPlayTricks();
    }
}

async function processFinalDiscardStep() {
     const currentPlayer = gameState.players[gameState.turnPlayerIndex];
      if (!currentPlayer || !gameState.needsFinalDiscardPlayers.some(p => p.id === currentPlayer.id) || currentPlayer.hasBid) {
          await moveToNextFinalDiscarder();
          if (gameState.phase === GAME_PHASE.FINAL_DISCARD && !gameState.isWaitingForBidInput && !gameState.isAnimating) { setTimeout(() => nextStep(), 10); }
          return;
      }
     const cardsToDiscardCount = Math.max(0, currentPlayer.hand.length - 4);
     if (cardsToDiscardCount <= 0) { currentPlayer.lastActionLog = `Discarded 0 (Final)`; }
     else {
          logMessage(`${currentPlayer.name} discards ${cardsToDiscardCount} down to 4.`);
          const cardsToDiscard = aiDecideCardToDiscard(currentPlayer, currentPlayer.hand, cardsToDiscardCount, "final discard", gameState.trumpSuit, gameState, currentStrategyConfig);
          if (!cardsToDiscard || cardsToDiscard.length !== cardsToDiscardCount) { logMessage("AI final discard error."); gameState.phase = GAME_PHASE.ROUND_END; return; }
          
          for(const card of cardsToDiscard){
            if (!card) continue;
            const playerHandElement = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
            if (playerHandElement) void playerHandElement.offsetHeight;

            const cardVisualElement = playerHandElement ? Array.from(playerHandElement.querySelectorAll('.card-image'))
                .find(img => img && img.alt && img.alt.startsWith(card.toString())) : null;

            let sourceForAnimation = playerHandElement || `#player-area-${currentPlayer.id}`;
            if (cardVisualElement) {
                sourceForAnimation = cardVisualElement;
                cardVisualElement.style.visibility = 'hidden';
            } else {
                logMessage(`Final Discard: Card visual for ${card.toString()} not found in ${currentPlayer.name}'s hand. Animating from general area.`);
            }
            await animateCardMovement(sourceForAnimation, '#talon-display', null, currentAnimationSpeed, {isDiscard:true});
            const rem = currentPlayer.removeCard(card); if(rem) gameState.discardPile.push(rem);
            renderGame(gameState);
          }
          currentPlayer.lastActionLog = `Discarded: ${cardsToDiscard.map(c => c.toString()).join(', ')} (Final)`;
    }
    currentPlayer.hasBid = true; 
    await moveToNextFinalDiscarder();
}

async function moveToNextFinalDiscarder() { 
    const nextDiscarder = gameState.needsFinalDiscardPlayers.find(p => !p.hasBid); 
    if (nextDiscarder) { 
        gameState.turnPlayerIndex = nextDiscarder.id; 
        logMessage(`Final discard turn to ${nextDiscarder.name}.`); 
    } else { 
        logMessage("Final discards complete."); 
        await checkAndMoveToPlayTricks(); 
    } 
}

async function checkAndMoveToPlayTricks() {
    logMessage("Proceeding to play tricks."); 
    gameState.phase = GAME_PHASE.PLAYING_TRICKS;
    gameState.activePlayerOrder = getActivePlayerOrder(gameState); 
    gameState.players.forEach(p => p.hasBid = false); 

    if (gameState.activePlayerOrder.length === 0) { 
       if (gameState.sneaker) { gameState.roundWinner = gameState.sneaker; gameState.phase = GAME_PHASE.SCORING; } 
       else { gameState.phase = GAME_PHASE.ROUND_END; } 
       gameState.turnPlayerIndex = -1; return;
    }
    let firstLeader = (gameState.sneaker && gameState.activePlayerOrder.some(p=>p.id===gameState.sneaker.id)) ? gameState.sneaker : gameState.activePlayerOrder[0];
    logMessage(`${firstLeader.name} leads the first trick.`); 
    gameState.turnPlayerIndex = firstLeader.id; 
    gameState.trickLeadPlayerIndex = firstLeader.id; 
    gameState.currentTrick = []; 
}

async function processPlayCardStep() {
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    if (!currentPlayer || !gameState.activePlayerOrder.some(p => p.id === currentPlayer.id)) {
         logMessage("Error: Invalid current player for play card step.");
         gameState.phase = gameState.currentTrick.length > 0 ? GAME_PHASE.TRICK_END : GAME_PHASE.ROUND_END; return;
    }
    if (currentPlayer.hand.length === 0) {
         logMessage(`${currentPlayer.name} has no cards to play.`);
         currentPlayer.lastActionLog = `(No cards)`; currentPlayer.hasBid = true;
         moveToNextPlayerInTrick(); 
         if (gameState.phase === GAME_PHASE.PLAYING_TRICKS && !gameState.isAnimating) setTimeout(() => nextStep(), 10);
         return;
    }
    logMessage(`Play turn for ${currentPlayer.name}. Trick: [${gameState.currentTrick.map(p => p.card.toString()).join(', ')}]`);
    const validPlays = GameRules.getValidPlays(gameState, currentPlayer);
    if (validPlays.length === 0) { logMessage(`CRITICAL: No valid plays for ${currentPlayer.name}!`); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const chosenCardByAI = aiDecideCardToPlay(currentPlayer, validPlays, gameState, currentStrategyConfig);
    let cardToPlay = validPlays.find(vc => vc && chosenCardByAI && vc.key === chosenCardByAI.key) || validPlays[0];
    if (!cardToPlay) { logMessage(`CRITICAL: No card chosen or valid for ${currentPlayer.name}!`); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const playerHandArea = document.querySelector(`#player-area-${currentPlayer.id} .player-hand`);
    if (playerHandArea) void playerHandArea.offsetHeight; 

    let sourceCardElement = playerHandArea ? Array.from(playerHandArea.querySelectorAll('.card-image'))
                              .find(img => img && img.alt && img.alt.startsWith(cardToPlay.toString())) : null;

    let sourceForAnimation = playerHandArea || `#player-area-${currentPlayer.id}`;
    if (sourceCardElement) {
        sourceForAnimation = sourceCardElement;
        sourceCardElement.style.visibility = 'hidden';
    } else {
        console.warn(`Play Card: Could not find specific card element for ${cardToPlay.toString()} in ${currentPlayer.name}'s hand to hide.`);
    }

    const trickAreaElement = document.getElementById('trick-area');
    await animateCardMovement(
        sourceForAnimation, 
        trickAreaElement,
        cardToPlay, 
        currentAnimationSpeed,
        { isPlayingToTrick: true, revealAtEnd: false }
    );

    const removed = currentPlayer.removeCard(cardToPlay); 
    if (removed) {
        gameState.currentTrick.push({ player: currentPlayer, card: cardToPlay });
        logMessage(`${currentPlayer.name} played ${cardToPlay}`);
        currentPlayer.lastActionLog = `Played: ${cardToPlay}`; currentPlayer.hasBid = true;
        renderGame(gameState);
    } else {
        logMessage("CRITICAL: Failed to remove card from hand data after animation.");
        if (sourceCardElement) sourceCardElement.style.visibility = 'visible';
        gameState.phase = GAME_PHASE.ROUND_END; return;
    }

    const playersExpectedInTrick = gameState.activePlayerOrder.filter(p => p.hand.length > 0 || gameState.currentTrick.some(play => play.player.id === p.id));
    if (gameState.currentTrick.length >= playersExpectedInTrick.length) {
        gameState.phase = GAME_PHASE.TRICK_END;
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
    const lastPlayerIndexInOrder = gameState.activePlayerOrder.findIndex(p => p.id === lastPlayerId);

    if (lastPlayerIndexInOrder === -1) { 
        logMessage("Error finding last player in active order for trick."); 
        gameState.phase = GAME_PHASE.TRICK_END; return; 
    }

    let nextPlayerToPlay = null;
    for (let i = 1; i <= gameState.activePlayerOrder.length; i++) {
          const nextIndex = (lastPlayerIndexInOrder + i) % gameState.activePlayerOrder.length;
          const potentialPlayer = gameState.activePlayerOrder[nextIndex];
          if (potentialPlayer &&
              !gameState.currentTrick.some(play => play.player.id === potentialPlayer.id) &&
              potentialPlayer.hand.length > 0) {
              nextPlayerToPlay = potentialPlayer;
              break;
          }
    }

    if (nextPlayerToPlay) {
        gameState.turnPlayerIndex = nextPlayerToPlay.id;
        logMessage(`Play turn to ${nextPlayerToPlay.name}.`);
    } else { 
        gameState.phase = GAME_PHASE.TRICK_END;
    }
}

async function processTrickEndStep() { // Added async
    if(!gameState.currentTrick || gameState.currentTrick.length === 0){ 
        const totalCardsInActiveHands = gameState.getActivePlayers().reduce((sum, p) => sum + (p.hand?.length || 0), 0);
        if (totalCardsInActiveHands === 0 || gameState.tricksPlayedCount >= 4) {
            gameState.phase = GAME_PHASE.SCORING;
        } else {
            logMessage("Warning: Trick end with no cards in trick, but game not over.");
            gameState.phase = GAME_PHASE.SCORING;
        }
        gameState.turnPlayerIndex = -1;
        return;
    }

    const winner = GameRules.determineTrickWinner(gameState.currentTrick, gameState.trumpSuit);
    if (!winner) { logMessage("Error determining trick winner!"); gameState.phase = GAME_PHASE.ROUND_END; return; }

    const winningCard = gameState.currentTrick.find(p=>p.player.id===winner.id)?.card;
    winner.tricksWonThisRound++;
    logMessage(`Trick ${gameState.tricksPlayedCount + 1} won by ${winner.name} with ${winningCard ? winningCard.toString() : 'N/A'}. (Tricks: ${winner.tricksWonThisRound})`);
    winner.lastActionLog = `Won trick ${gameState.tricksPlayedCount + 1}`;

    // --- NEW: Animation for collecting trick ---
    const trickAreaCenterCoords = getElementCoordinates('#trick-area'); // Get general trick area coords
    // Adjust if you want a more specific point like center of trick area
    const sourceAnimationCoords = {
        top: trickAreaCenterCoords.top + (trickAreaCenterCoords.height / 2) - (108 / 2), // Card height
        left: trickAreaCenterCoords.left + (trickAreaCenterCoords.width / 2) - (72 / 2)  // Card width
    };
    const winnerPlayerAreaSelector = `#player-area-${winner.id}`;
    
    await animateCardMovement(
        sourceAnimationCoords,
        winnerPlayerAreaSelector,
        null, // card back
        currentAnimationSpeed * 0.6, // Make this animation a bit faster
        { isDiscard: true } // Using isDiscard option to ensure card back and simple vanish
    );
    // --- END NEW Animation ---

    if(!gameState.discardPile) gameState.discardPile = [];
    gameState.discardPile.push(...gameState.currentTrick.map(p => p.card).filter(c => c)); 
    gameState.currentTrick = []; // Clear after animation and data move
    renderGame(gameState); // Re-render to show empty trick area before next logic

    gameState.tricksPlayedCount++;
    gameState.players.forEach(p => p.hasBid = false); 

    if (gameState.tricksPlayedCount >= 4) {
        gameState.phase = GAME_PHASE.SCORING;
        gameState.turnPlayerIndex = -1;
    } else {
        if (gameState.activePlayerOrder.some(p => p.id === winner.id)) {
             gameState.phase = GAME_PHASE.PLAYING_TRICKS;
             gameState.turnPlayerIndex = winner.id;
             gameState.trickLeadPlayerIndex = winner.id; 
        } else {
             logMessage("Error: Trick winner not in active order. Scoring.");
             gameState.phase = GAME_PHASE.SCORING; 
             gameState.turnPlayerIndex = -1;
        }
    }
}

function processAllWeiterPenalty() { 
    logMessage("Applying 'All Weiter' penalty."); 
    const scores = GameRules.calculateAllWeiterScores(gameState, currentDealerAnte); 
    gameState.players.forEach(player => { 
        const scoreInfo = scores[player.id]; 
        if (scoreInfo) { 
            player.points += scoreInfo.points; 
            player.lastActionLog = `All Weiter (${scoreInfo.points >= 0 ? '+' : ''}${scoreInfo.points.toFixed(1)})`; 
        } else { 
            player.lastActionLog = `All Weiter (Error)`; 
        } 
    }); 
    gameState.phase = GAME_PHASE.ROUND_END; 
    gameState.turnPlayerIndex = -1; 
    gameState.lastActionLog = `Round ended: All Weiter.`; 
}

function processScoringStep() {
    logMessage("Calculating scores..."); 
    let scores;
    try { 
        scores = GameRules.calculateRoundScores(gameState, currentDealerAnte, currentMuasPenalty); 
    } catch (error) { 
        logMessage("Scoring error: " + error.message); 
        gameState.phase = GAME_PHASE.ROUND_END; 
        gameState.turnPlayerIndex = -1; 
        return; 
    }
    let roundSummaryLog = "Round scored: ";
    for (const player of gameState.players) {
        const scoreInfo = scores[player.id];
        if (scoreInfo) {
            player.points += scoreInfo.points;
            let outcomeDesc = (gameState.roundWinner && player === gameState.roundWinner) ? `Won Uncontested!` :
                              (player.status === PLAYER_STATUS.ACTIVE_SNEAKER) ? (scoreInfo.tricks >= 2 ? `Sneaker Success!` : `Sneaker Failed!`) :
                              (player.status === PLAYER_STATUS.ACTIVE_PLAYER) ? (scoreInfo.tricks >= 1 ? `Player Success` : `Player Failed!`) :
                              (player.status === PLAYER_STATUS.FOLDED) ? `Folded` : `(Inactive)`;
            player.lastActionLog = `${outcomeDesc} (${scoreInfo.points >= 0 ? '+' : ''}${scoreInfo.points.toFixed(1)})`;
            roundSummaryLog += `${player.name} ${player.lastActionLog}; `;
        } else { 
            player.lastActionLog = `(Score Error)`; 
            roundSummaryLog += `${player.name} (Error); `; 
        }
    }
    gameState.phase = GAME_PHASE.ROUND_END; 
    gameState.turnPlayerIndex = -1;
    gameState.lastActionLog = roundSummaryLog.trim();
}


// --- Core Exported Step Function & Bid Handler (Defined AFTER phase processors) ---
export async function nextStep() {
    if (!gameState) { logMessage("Error: gameState is null."); return; }
    if (gameState.isWaitingForBidInput) { logMessage("Waiting for user input..."); renderGame(gameState); return; }
    if (gameState.isAnimating) { logMessage("Animation in progress, please wait..."); return; }

    gameState.isAnimating = true;
    const nextStepButton = document.getElementById('next-step');
    if (nextStepButton) nextStepButton.disabled = true;

    logMessage(`--- Executing Step: Current Phase [${gameState.phase}] ---`);
    try {
        switch (gameState.phase) {
            case GAME_PHASE.SETUP: case GAME_PHASE.ROUND_END: await startNewRound(); break;
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
            case GAME_PHASE.TRICK_END: await processTrickEndStep(); break; // Made async
            case GAME_PHASE.ALL_WEITER_PENALTY: processAllWeiterPenalty(); break;
            case GAME_PHASE.SCORING: processScoringStep(); break;
            default: logMessage(`Error: Unknown game phase: ${gameState.phase}`); gameState.phase = GAME_PHASE.ROUND_END;
        }
    } catch (error) {
        logMessage(`!!! Runtime Error in phase ${gameState.phase}: ${error.message} !!!`);
        console.error("Error during phase execution:", gameState.phase, error.stack);
        gameState.phase = GAME_PHASE.ROUND_END;
        gameState.lastActionLog = `Error: ${error.message}`;
    } finally {
        gameState.isAnimating = false;
        if (nextStepButton) nextStepButton.disabled = gameState.isWaitingForBidInput; 
    }

    if (!gameState.isWaitingForBidInput) {
         renderGame(gameState);
         const errorEndedRound = gameState.phase === GAME_PHASE.ROUND_END && gameState.lastActionLog?.includes("Error");
         if (gameState.phase !== GAME_PHASE.ROUND_END || !errorEndedRound) {
             logMessage(`--- Step Complete: Now Phase [${gameState.phase}] ---`);
         } else if (errorEndedRound) {
             logMessage(`--- Round ended due to error. ---`);
         }
    } else {
         renderGame(gameState);
         logMessage(`--- Paused for Input: Phase [${gameState.phase}] Player: ${gameState.players[gameState.turnPlayerIndex]?.name} ---`);
    }
}

export async function handleUserBid(chosenBid) {
    if (!gameState || !gameState.isWaitingForBidInput) { return; }
    const currentPlayer = gameState.players[gameState.turnPlayerIndex];
    const validBids = gameState.pendingValidBids;
    const stage = gameState.phase;
    if (!currentPlayer) { gameState.isWaitingForBidInput = false; return; }

    logMessage(`User (${currentPlayer.name}) selected bid: ${chosenBid}`);
    if (!validBids.includes(chosenBid)) { renderGame(gameState); return; }

    gameState.isWaitingForBidInput = false;
    gameState.pendingValidBids = [];
    gameState.isAnimating = true; 
    const nextStepButton = document.getElementById('next-step');
    if (nextStepButton) nextStepButton.disabled = true;

    await _processChosenBid(currentPlayer, chosenBid, stage, gameState);
    
    gameState.isAnimating = false;
    if (nextStepButton) nextStepButton.disabled = false; 
    
    renderGame(gameState);

    const nextPlayer = gameState.players[gameState.turnPlayerIndex]; 
    let shouldPauseForNextStep = false;
    if (isManualBiddingMode && gameState.turnPlayerIndex !== -1 && nextPlayer) { 
        if ((gameState.phase === GAME_PHASE.BIDDING_STAGE_1 || gameState.phase === GAME_PHASE.BIDDING_STAGE_2)) {
             let currentTurnPlayer = gameState.players[gameState.turnPlayerIndex];
             if (currentTurnPlayer) { 
                let nextPlayerNeedsToAct = (gameState.phase === GAME_PHASE.BIDDING_STAGE_1) ?
                                        (!currentTurnPlayer.hasBid && currentTurnPlayer.status !== PLAYER_STATUS.FOLDED) :
                                        (currentTurnPlayer !== gameState.sneaker && currentTurnPlayer !== gameState.oderPlayer && !currentTurnPlayer.hasBid && currentTurnPlayer.status !== PLAYER_STATUS.FOLDED);
                if (nextPlayerNeedsToAct) { 
                    shouldPauseForNextStep = true;
                }
             }
        }
    }

     if (!shouldPauseForNextStep && !gameState.isAnimating) {
         logMessage(`--- Bid Processed. Auto-advancing... ---`);
         setTimeout(() => nextStep(), 50);
     } else if (shouldPauseForNextStep) {
         logMessage(`--- Bid Processed. Pausing for next manual input. ---`);
         renderGame(gameState); 
     }
}