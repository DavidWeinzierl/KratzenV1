// js/aiPlayer.js

import { logMessage as importedLogMessage } from './logger.js'; // Rename to avoid conflict
import { GAME_PHASE, EXCHANGE_TYPE } from './constants.js'; 
import * as Strategies from './aiStrategies.js';

// Helper to conditionally log
function logAICall(isSimulating, message) {

    if (!isSimulating) {
        importedLogMessage(message);
    }
}

function getRandomElement(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
}

export function aiDecideBid(player, validBids, gameState, currentStrategyConfig, isSimulating) {
    logAICall(isSimulating, `AI (${player.name}): Dispatching to strategy for BID. Phase: ${gameState.phase}. Valid: ${validBids.join(', ')}`);
    let choice = null;
    const configForStrategy = { ...currentStrategyConfig, isSimulationRunning: isSimulating };

    if (gameState.phase === GAME_PHASE.BIDDING_STAGE_1) {
        choice = Strategies.decideBidStage1(player, validBids, gameState, configForStrategy);
    } else if (gameState.phase === GAME_PHASE.BIDDING_STAGE_2) {
        choice = Strategies.decideBidStage2(player, validBids, gameState, configForStrategy);
    } else {
        logAICall(isSimulating, `AI ERROR (${player.name}): aiDecideBid called in unexpected phase: ${gameState.phase}`);
    }

    if (choice && validBids.includes(choice)) {
        logAICall(isSimulating, `AI (${player.name}): Strategy returned valid bid -> ${choice}`);
        return choice;
    } else {
        if (choice) {
            logAICall(isSimulating, `AI WARNING (${player.name}): Strategy returned invalid bid '${choice}'. Valid: ${validBids.join(', ')}. Using fallback.`);
        } else {
            logAICall(isSimulating, `AI (${player.name}): Strategy did not provide a bid. Using fallback.`);
        }
        const fallbackChoice = getRandomElement(validBids);
        logAICall(isSimulating, `AI (${player.name}): Fallback bid -> ${fallbackChoice || 'None (No valid bids for fallback)'}`);
        return fallbackChoice;
    }
}

export function aiDecideExchange(player, validOptions, trumpSuit, gameState, currentStrategyConfig, isSimulating) {
    logAICall(isSimulating, `AI (${player.name}): Dispatching to strategy for EXCHANGE. Trump: ${trumpSuit}.`);
    const configForStrategy = { ...currentStrategyConfig, isSimulationRunning: isSimulating };
    let decision = Strategies.decideExchange(player, validOptions, trumpSuit, gameState, configForStrategy);

    if (!decision || !decision.type || !validOptions.some(opt => opt.type === decision.type)) {
        logAICall(isSimulating, `AI WARNING (${player.name}): Strategy returned invalid exchange decision type '${decision?.type}'. Using fallback (Standard, discard 0).`);
        const standardOption = validOptions.find(opt => opt.type === EXCHANGE_TYPE.STANDARD) || { type: EXCHANGE_TYPE.STANDARD, maxCards: 4 }; 
        decision = { type: standardOption.type, cardsToDiscard: [] };
    } else {
        logAICall(isSimulating, `AI (${player.name}): Strategy returned exchange -> Type: ${decision.type}, Discarding: ${decision.cardsToDiscard.map(c => c.toString()).join(', ')}`);
    }
    return decision;
}

export function aiDecideCardToPlay(player, validPlays, gameState, currentStrategyConfig, isSimulating) {
    logAICall(isSimulating, `AI (${player.name}): Dispatching to strategy for CARD PLAY. Valid: ${validPlays.map(c => c.toString()).join(', ')}`);
    let choice = null;
    const configForStrategy = { ...currentStrategyConfig, isSimulationRunning: isSimulating };

    if (gameState.currentTrick.length === 0) { 
        logAICall(isSimulating, `AI (${player.name}): Leading the trick.`);
        choice = Strategies.decidePlayLead(player, validPlays, gameState, configForStrategy);
    } else { 
        logAICall(isSimulating, `AI (${player.name}): Following the trick. Current trick: ${gameState.currentTrick.map(p => p.card.toString()).join(', ')}`);
        choice = Strategies.decidePlayFollow(player, validPlays, gameState, configForStrategy);
    }

    const isValidChoice = choice && validPlays.some(validCard => validCard && choice && validCard.key === choice.key);
    if (isValidChoice) {
        logAICall(isSimulating, `AI (${player.name}): Strategy returned valid play -> ${choice.toString()}`);
        return choice;
    } else {
        if (choice) {
            logAICall(isSimulating, `AI WARNING (${player.name}): Strategy returned invalid play '${choice?.toString()}'. Valid: ${validPlays.map(c => c.toString()).join(', ')}. Using fallback.`);
        } else {
            logAICall(isSimulating, `AI (${player.name}): Strategy did not provide a play. Using fallback.`);
        }
        const fallbackChoice = getRandomElement(validPlays); 
        if (!fallbackChoice && validPlays.length > 0) { 
            logAICall(isSimulating, `AI ERROR (${player.name}): getRandomElement failed for fallback play despite validPlays. Choosing first valid.`);
            return validPlays[0];
        }
        logAICall(isSimulating, `AI (${player.name}): Fallback play -> ${fallbackChoice ? fallbackChoice.toString() : 'None (No valid plays for fallback!)'}`);
        return fallbackChoice;
    }
}

export function aiDecideCardToDiscard(player, cardsToDiscardFrom, count, reason, trumpSuit, gameState, currentStrategyConfig, isSimulating) {
    logAICall(isSimulating, `AI (${player.name}): Dispatching to strategy for DISCARD (${reason}). Count: ${count}. Trump: ${trumpSuit}.`);
    const configForStrategy = { ...currentStrategyConfig, isSimulationRunning: isSimulating };

    let cardsToDiscard = Strategies.decideGenericDiscard(player, cardsToDiscardFrom, count, reason, trumpSuit, gameState, configForStrategy);

    if (!cardsToDiscard || !Array.isArray(cardsToDiscard) || cardsToDiscard.length !== count) {
        logAICall(isSimulating, `AI WARNING (${player.name}): Strategy for DISCARD returned invalid result. Needed ${count}, got ${cardsToDiscard?.length}. Using fallback (discard lowest value).`);
        
        const rankOrder = "789XUOKA"; 
        let sortedHandCopy = [...cardsToDiscardFrom].sort((a,b) => {
            let valA = rankOrder.indexOf(a.rank);
            let valB = rankOrder.indexOf(b.rank);
            if (valA === -1) valA = 99; 
            if (valB === -1) valB = 99;
            return valA - valB;
        });
        cardsToDiscard = sortedHandCopy.slice(0, count);
    } else {
        logAICall(isSimulating, `AI (${player.name}): Strategy returned discards -> ${cardsToDiscard.map(c => c.toString()).join(', ')}`);
    }
    return cardsToDiscard;
}