// js/aiPlayer.js

import { logMessage } from './logger.js';
import { GAME_PHASE, EXCHANGE_TYPE, WELI_RANK } from './constants.js'; // WELI_RANK might be used in fallbacks or directly here.

// Import all strategy functions from aiStrategies.js
import * as Strategies from './aiStrategies.js';

// Helper function to pick a random element from an array (useful for fallbacks)
function getRandomElement(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

// --- AI Decision Functions ---
// These functions now primarily delegate to aiStrategies.js

export function aiDecideBid(player, validBids, gameState, currentStrategyConfig) {
    logMessage(`AI (${player.name}): Dispatching to strategy for BID. Phase: ${gameState.phase}. Valid: ${validBids.join(', ')}`);
    let choice = null;

    if (gameState.phase === GAME_PHASE.BIDDING_STAGE_1) {
        choice = Strategies.decideBidStage1(player, validBids, gameState, currentStrategyConfig);
    } else if (gameState.phase === GAME_PHASE.BIDDING_STAGE_2) {
        choice = Strategies.decideBidStage2(player, validBids, gameState, currentStrategyConfig);
    } else {
        logMessage(`AI ERROR (${player.name}): aiDecideBid called in unexpected phase: ${gameState.phase}`);
    }

    // Validate strategy choice and provide fallback
    if (choice && validBids.includes(choice)) {
        logMessage(`AI (${player.name}): Strategy returned valid bid -> ${choice}`);
        return choice;
    } else {
        if (choice) { // Strategy returned something, but it wasn't in validBids
            logMessage(`AI WARNING (${player.name}): Strategy returned invalid bid '${choice}'. Valid: ${validBids.join(', ')}. Using fallback.`);
        } else { // Strategy returned null/undefined
            logMessage(`AI (${player.name}): Strategy did not provide a bid. Using fallback.`);
        }
        const fallbackChoice = getRandomElement(validBids);
        logMessage(`AI (${player.name}): Fallback bid -> ${fallbackChoice || 'None (No valid bids for fallback)'}`);
        return fallbackChoice;
    }
}

export function aiDecideExchange(player, validOptions, trumpSuit, gameState, currentStrategyConfig) {
    logMessage(`AI (${player.name}): Dispatching to strategy for EXCHANGE. Trump: ${trumpSuit}.`);
    let decision = Strategies.decideExchange(player, validOptions, trumpSuit, gameState, currentStrategyConfig);

    // Validate strategy decision (basic check)
    if (!decision || !decision.type || !validOptions.some(opt => opt.type === decision.type)) {
        logMessage(`AI WARNING (${player.name}): Strategy returned invalid exchange decision type '${decision?.type}'. Using fallback (Standard, discard 0).`);
        // Failsafe: Standard exchange, discard nothing
        const standardOption = validOptions.find(opt => opt.type === EXCHANGE_TYPE.STANDARD) || { type: EXCHANGE_TYPE.STANDARD, maxCards: 4 }; // Ensure standardOption exists
        decision = { type: standardOption.type, cardsToDiscard: [] };
    } else {
        logMessage(`AI (${player.name}): Strategy returned exchange -> Type: ${decision.type}, Discarding: ${decision.cardsToDiscard.map(c => c.toString()).join(', ')}`);
    }
    return decision;
}

export function aiDecideCardToPlay(player, validPlays, gameState, currentStrategyConfig) {
    logMessage(`AI (${player.name}): Dispatching to strategy for CARD PLAY. Valid: ${validPlays.map(c => c.toString()).join(', ')}`);
    let choice = null;

    if (gameState.currentTrick.length === 0) { // Player is leading the trick
        logMessage(`AI (${player.name}): Leading the trick.`);
        choice = Strategies.decidePlayLead(player, validPlays, gameState, currentStrategyConfig);
    } else { // Player is following
        logMessage(`AI (${player.name}): Following the trick. Current trick: ${gameState.currentTrick.map(p => p.card.toString()).join(', ')}`);
        choice = Strategies.decidePlayFollow(player, validPlays, gameState, currentStrategyConfig);
    }

    // Validate strategy choice and provide fallback
    const isValidChoice = choice && validPlays.some(validCard => validCard && choice && validCard.key === choice.key);
    if (isValidChoice) {
        logMessage(`AI (${player.name}): Strategy returned valid play -> ${choice.toString()}`);
        return choice;
    } else {
        if (choice) {
            logMessage(`AI WARNING (${player.name}): Strategy returned invalid play '${choice?.toString()}'. Valid: ${validPlays.map(c => c.toString()).join(', ')}. Using fallback.`);
        } else {
            logMessage(`AI (${player.name}): Strategy did not provide a play. Using fallback.`);
        }
        const fallbackChoice = getRandomElement(validPlays); // Fallback to random valid play
        if (!fallbackChoice && validPlays.length > 0) { // Should not happen if validPlays has items
            logMessage(`AI ERROR (${player.name}): getRandomElement failed for fallback play despite validPlays. Choosing first valid.`);
            return validPlays[0];
        }
        logMessage(`AI (${player.name}): Fallback play -> ${fallbackChoice ? fallbackChoice.toString() : 'None (No valid plays for fallback!)'}`);
        return fallbackChoice;
    }
}

export function aiDecideCardToDiscard(player, cardsToDiscardFrom, count, reason, trumpSuit, gameState, currentStrategyConfig) {
    // Note: 'cardsToDiscardFrom' is the player's full hand or relevant subset.
    // 'count' is the number of cards they MUST discard.
    logMessage(`AI (${player.name}): Dispatching to strategy for DISCARD (${reason}). Count: ${count}. Trump: ${trumpSuit}.`);

    let cardsToDiscard = Strategies.decideGenericDiscard(player, cardsToDiscardFrom, count, reason, trumpSuit, gameState, currentStrategyConfig);

    // Validate strategy decision
    if (!cardsToDiscard || !Array.isArray(cardsToDiscard) || cardsToDiscard.length !== count) {
        logMessage(`AI WARNING (${player.name}): Strategy for DISCARD returned invalid result (count mismatch or not array). Needed ${count}, got ${cardsToDiscard?.length}. Using fallback (discard lowest value).`);
        // Fallback: discard the 'count' lowest value cards from the hand
        let sortedHandCopy = [...cardsToDiscardFrom].sort((a, b) => {
            const valA = getCardValue(a, trumpSuit); // Assuming getCardValue exists and is imported or available
            const valB = getCardValue(b, trumpSuit);
            return valA - valB;
        });
        cardsToDiscard = sortedHandCopy.slice(0, count);
    } else {
        logMessage(`AI (${player.name}): Strategy returned discards -> ${cardsToDiscard.map(c => c.toString()).join(', ')}`);
    }
    return cardsToDiscard;
}