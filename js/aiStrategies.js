// js/aiStrategies.js

import { BID_OPTIONS, EXCHANGE_TYPE, RANKS, WELI_RANK, SUITS, getCardValue, PLAYER_STATUS } from './constants.js';
import { logMessage } from './logger.js'; 
import { GameRules } from './gameLogic.js';

// --- Helper Functions (Internal to this module or could be moved to a utility file) ---

function _hasCard(player, rank, suit = null) {
    if (!player || !player.hand) return false;
    return player.hand.some(card => card.rank === rank && (suit ? card.suit === suit : true));
}

function _getCardsOfSuit(player, suit) {
    if (!player || !player.hand) return [];
    return player.hand.filter(card => card.suit === suit);
}

function _getTrumpCards(player, trumpSuit) {
    if (!player || !player.hand || !trumpSuit) return [];
    return player.hand.filter(card => card.suit === trumpSuit || card.rank === WELI_RANK);
}

function _countTrumps(player, trumpSuit) {
    return _getTrumpCards(player, trumpSuit).length;
}

function _getTrumpCardsWithValueOrHigher(player, trumpSuit, minRank, ranksOrder = RANKS) {
    if (!player || !player.hand || !trumpSuit || !minRank) return _getTrumpCards(player, trumpSuit); // Return all trumps if minRank is not specified
    const minRankIndex = ranksOrder.indexOf(minRank);
    if (minRankIndex === -1) return _getTrumpCards(player, trumpSuit);

    return _getTrumpCards(player, trumpSuit).filter(card => {
        if (card.rank === WELI_RANK) return true; // Weli is always high
        const cardRankIndex = ranksOrder.indexOf(card.rank);
        return cardRankIndex >= minRankIndex;
    });
}

function _getNonTrumpAces(player, trumpSuit) {
    if (!player || !player.hand) return [];
    return player.hand.filter(card => card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK);
}

function _isLastToBid(gameState, player, stage1 = true) {
    const activeBidders = gameState.players.filter(p => {
        if (p.status === PLAYER_STATUS.FOLDED) return false;
        if (p.hasBid) return false;
        if (!stage1 && gameState.sneaker && p.id === gameState.sneaker.id) return false;
        return true;
    });

    if (activeBidders.length === 0) return false;

    let turnOrder = [];
    let currentTurn = gameState.turnPlayerIndex;
    let initialTurn = gameState.turnPlayerIndex; 

    do {
        const p = gameState.players[currentTurn];
        if (activeBidders.includes(p)) {
            turnOrder.push(p);
        }
        currentTurn = gameState.nextPlayerIndex(currentTurn);
    } while (currentTurn !== initialTurn && turnOrder.length < activeBidders.length);

    return turnOrder.length > 0 && turnOrder[turnOrder.length - 1].id === player.id;
}


function _noOneElseBidSneakOrOder(gameState, currentPlayer) {
    if (gameState.sneaker && gameState.sneaker.id !== currentPlayer.id) return false;
    if (gameState.oderPlayer && gameState.oderPlayer.id !== currentPlayer.id) return false;
    return true; 
}


function _playersJoinedGame(gameState) {
    return gameState.players.filter(p => p.status === PLAYER_STATUS.ACTIVE_PLAYER || p.status === PLAYER_STATUS.ACTIVE_SNEAKER).length;
}


function _sortCardsByValue(cards, trumpSuit, ascending = true) {
    if (!cards || !Array.isArray(cards)) {
        logMessage(`_sortCardsByValue: Input 'cards' is not a valid array. Received: ${JSON.stringify(cards)}`);
        return [];
    }
    const cleanCards = cards.filter(card => {
        if (!card || typeof card.rank === 'undefined' || typeof card.suit === 'undefined') {
            return false;
        }
        return true;
    });

    if (cleanCards.length === 0) {
        return [];
    }

    return cleanCards.sort((a, b) => {
        const valA = getCardValue(a, trumpSuit);
        const valB = getCardValue(b, trumpSuit);
        if (typeof valA !== 'number' || isNaN(valA)) return ascending ? 1 : -1; 
        if (typeof valB !== 'number' || isNaN(valB)) return ascending ? -1 : 1;
        return ascending ? valA - valB : valB - valA;
    });
}



export function decideExchange(player, validExchangeOptions, trumpSuit, gameState, config) {
    // --- PRE-CALCULATIONS AND CHECKS ---
    const hasWeli = _hasCard(player, WELI_RANK);
    const trumpCardsInHand = _getTrumpCards(player, trumpSuit);
    const numTrumps = trumpCardsInHand.length;

    //  DETECT IF A PREVIOUS PLAYER DISCARDED ZERO CARDS ---
    let anyPreviousPlayerDiscardedZero = false;
    if (gameState.activePlayerOrder && gameState.activePlayerOrder.length > 0) {
        const currentPlayerIndexInOrder = gameState.activePlayerOrder.findIndex(p => p.id === player.id);
        if (currentPlayerIndexInOrder > 0) { // Only check if not the first player to exchange
            for (let i = 0; i < currentPlayerIndexInOrder; i++) {
                const previousPlayer = gameState.activePlayerOrder[i];
                // Check if the previous player has completed their standard exchange and discarded 0.
                if (previousPlayer.hasBid && // 'hasBid' is used to mark a completed turn in this phase
                    previousPlayer.exchangeAction === EXCHANGE_TYPE.STANDARD &&
                    previousPlayer.lastActionLog &&
                    previousPlayer.lastActionLog.includes("Kauft 0")) { // Check the log for the specific action
                    anyPreviousPlayerDiscardedZero = true;
                    logMessage(`AI (${player.name}): Detected ${previousPlayer.name} previously discarded 0 cards. Non-trump aces are now less valuable.`);
                    break;
                }
            }
        }
    }

    // --- PRIORITY 1: MANDATORY/BEST EXCHANGES ---
    // "4 auf die Sau" is always the best move.
    const sauOption = validExchangeOptions.find(opt => opt.type === EXCHANGE_TYPE.SAU);
    if (sauOption) {
        logMessage(`AI (${player.name}): Strategy Exchange - "4 auf die Sau" is available. Choosing SAU.`);
        return { type: EXCHANGE_TYPE.SAU, cardsToDiscard: [] };
    }

    // --- PRIORITY 2: OPPORTUNISTIC PACKERL (Based on current hand) ---
    // Trumpf-Packerl: No Weli, single low trump.
    const canDoTrumpfPackerl = validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.TRUMPF_PACKERL);
    if (canDoTrumpfPackerl && !hasWeli && numTrumps === 1) {
        const isLowTrump = RANKS.indexOf(trumpCardsInHand[0].rank) <= RANKS.indexOf(config.exchange.maxTrumpValueForTrumpfPackerl);
        if (isLowTrump) {
            logMessage(`AI (${player.name}): Strategy Exchange - Has one low trump. Choosing TRUMPF_PACKERL.`);
            return { type: EXCHANGE_TYPE.TRUMPF_PACKERL, cardsToDiscard: [] };
        }
    }

    // Normales-Packerl: No Trumps. (This check is for the initial hand state).
    const canDoNormalPackerl = validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.NORMAL_PACKERL);
    if (canDoNormalPackerl && numTrumps === 0) {
        logMessage(`AI (${player.name}): Strategy Exchange - Has no trumps. Choosing NORMAL_PACKERL.`);
        return { type: EXCHANGE_TYPE.NORMAL_PACKERL, cardsToDiscard: [] };
    }


    // --- PRIORITY 3: STANDARD EXCHANGE (with intelligent discard and Packerl re-evaluation) ---
    const standardOption = validExchangeOptions.find(opt => opt.type === EXCHANGE_TYPE.STANDARD);
    if (standardOption) {
        let cardsToKeep = [];
        // Always keep trumps.
        cardsToKeep.push(...trumpCardsInHand);

        // --- MODIFIED ACE LOGIC ---
        // Only consider keeping non-trump aces if no one has signaled strength.
        if (!anyPreviousPlayerDiscardedZero) {
            let nonTrumpAces = _getNonTrumpAces(player, trumpSuit);
            if (nonTrumpAces.length > 0) {
                // Keep only the single best non-trump Ace.
                const sortedAces = _sortCardsByValue(nonTrumpAces, null, false); // Sort descending
                cardsToKeep.push(sortedAces[0]);
            }
        } else {
            logMessage(`AI (${player.name}): Opponent discarded 0, so non-trump aces will not be prioritized.`);
        }

        // Determine cards to discard for a standard exchange.
        let potentialDiscards = player.hand.filter(card => !cardsToKeep.some(k => k.key === card.key));
        potentialDiscards = _sortCardsByValue(potentialDiscards, trumpSuit, true); // Sort lowest value first

        const maxDiscardCount = Math.min(standardOption.maxCards || 4, player.hand.length - 1); // Must keep at least 1 card
        const cardsToDiscardForStandard = potentialDiscards.slice(0, maxDiscardCount);

        // --- NEW: RE-EVALUATE FOR PACKERL ---
        // If we decided to discard our non-trump aces, does that now make a Packerl possible?
        const tempHandAfterStandardDiscard = player.hand.filter(c => !cardsToDiscardForStandard.some(d => d.key === c.key));
        const trumpsInTempHand = _getTrumpCards({ hand: tempHandAfterStandardDiscard }, trumpSuit).length;

        if (trumpsInTempHand === 0 && canDoNormalPackerl) {
            logMessage(`AI (${player.name}): Strategy Exchange - After considering standard discard, now has 0 trumps. Overriding to choose NORMAL_PACKERL.`);
            return { type: EXCHANGE_TYPE.NORMAL_PACKERL, cardsToDiscard: [] };
        }
        
        // If no override, proceed with the calculated standard exchange.
        logMessage(`AI (${player.name}): Strategy Exchange - Standard. Discarding ${cardsToDiscardForStandard.length} cards: ${cardsToDiscardForStandard.map(c=>c.toString()).join(', ')}.`);
        return { type: EXCHANGE_TYPE.STANDARD, cardsToDiscard: cardsToDiscardForStandard };
    }

    // Absolute fallback if no other option makes sense (should be rare).
    logMessage(`AI (${player.name}): Strategy Exchange - Fallback: No valid option processed. Choosing first available.`);
    const fallbackOption = validExchangeOptions[0] || { type: EXCHANGE_TYPE.STANDARD, cardsToDiscard: []};
    if (fallbackOption.type === EXCHANGE_TYPE.STANDARD && !fallbackOption.cardsToDiscard) {
        fallbackOption.cardsToDiscard = [];
    }
    return fallbackOption;
}

export function decidePlayLead(player, validPlays, gameState, config) {
    const trumpSuit = gameState.trumpSuit;
    const isSimulating = config.isSimulationRunning;


        // ---  LOGIC for 3rd Trick, 2 Trumps in Hand ---
    // Condition: 3rd trick (tricksPlayedCount is 2), player has 2 cards, both are trumps, one is Ace
    if (gameState.tricksPlayedCount === 2 && player.hand.length === 2) {
        const trumpCardsInHand = _getTrumpCards(player, trumpSuit);
        if (trumpCardsInHand.length === 2) { // Both cards are trumps
            const trumpAce = trumpCardsInHand.find(c => c && c.rank === 'A' && c.suit === trumpSuit);
            // Check if the trump ace exists and is a valid play
            if (trumpAce && validPlays.some(vp => vp && vp.key === trumpAce.key)) {
                if (!isSimulating) {
                    logMessage(`AI (${player.name}): Strategy PlayLead - Special Rule: 3rd trick, 2 trumps left. Leading with Trump Ace.`);
                }
                return trumpAce;
            }
        }
    }
    // Check if a SauWeli plan is active or if the player generally has the SauWeli combo
    if (player.aiPlan && player.aiPlan.sauWeliLeadState) {
        const currentTrumpAce = player.hand.find(c => c && c.rank === 'A' && c.suit === trumpSuit);
        const currentWeli = player.hand.find(c => c && c.rank === WELI_RANK);

        if (player.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_ACE') {
            if (!currentTrumpAce || !currentWeli) { // Both must be present to start/continue leading Ace
                if (!isSimulating) logMessage(`AI (${player.name}): SauWeli Plan (Lead Ace phase) broken - missing Ace or Weli. Clearing plan.`);
                player.hasSauWeli = (currentTrumpAce && currentWeli); // Update general flag
                player.aiPlan.sauWeliLeadState = null;
            } else if (currentTrumpAce && validPlays.some(vp => vp && vp.key === currentTrumpAce.key)) {
                if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli Plan: Leading Trump Ace.`);
                return currentTrumpAce;
            } else {
                if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli Plan: Wanted Trump Ace, but not found/valid. Plan disrupted.`);
                player.aiPlan.sauWeliLeadState = null; // Disrupt plan if Ace can't be played
            }
        } else if (player.aiPlan.sauWeliLeadState === 'READY_TO_LEAD_WELI') {
            if (!currentWeli) { // Only Weli needs to be present now
                if (!isSimulating) logMessage(`AI (${player.name}): SauWeli Plan (Lead Weli phase) broken - Weli missing. Clearing plan.`);
                player.hasSauWeli = false; // Weli is gone, so combo is gone
                player.aiPlan.sauWeliLeadState = null;
            } else if (currentWeli && validPlays.some(vp => vp && vp.key === currentWeli.key)) {
                if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli Plan: Leading Weli.`);
                return currentWeli;
            } else {
                if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli Plan: Wanted Weli, but not found/valid. Plan disrupted.`);
                player.aiPlan.sauWeliLeadState = null; // Disrupt plan if Weli can't be played
            }
        }
        // If player.aiPlan.sauWeliLeadState was just nulled out, we fall through to fallback.
    } else if (player.hasSauWeli) { 
        // This case handles if player.hasSauWeli is true, but no aiPlan.sauWeliLeadState exists yet.
        // This means they just acquired SauWeli (e.g., after exchange) and this is their first lead opportunity.
        const currentTrumpAce = player.hand.find(c => c && c.rank === 'A' && c.suit === trumpSuit);
        const currentWeli = player.hand.find(c => c && c.rank === WELI_RANK);

        if (currentTrumpAce && currentWeli) { // Both must be present to initiate the plan
            if (!player.aiPlan) player.aiPlan = {};
            if (validPlays.some(vp => vp && vp.key === currentTrumpAce.key)) {
                 if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli acquired. Initiating plan: Leading Trump Ace.`);
                 player.aiPlan.sauWeliLeadState = 'READY_TO_LEAD_ACE'; // Set state before returning
                 return currentTrumpAce;
            } else {
                 if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - SauWeli acquired, but cannot lead Trump Ace. Plan not started.`);
                 // Do not set sauWeliLeadState yet, let fallback happen.
            }
        } else {
             // Should not happen if hasSauWeli is true and just checked, but as a safeguard.
             if (!isSimulating) logMessage(`AI (${player.name}): hasSauWeli true, but components missing. Clearing hasSauWeli.`);
             player.hasSauWeli = false;
        }
    }

    // If we reach here, either no SauWeli plan, or it was disrupted / couldn't be executed.
    if (! (player.aiPlan && player.aiPlan.sauWeliLeadState) ) { // Check if plan is still active before logging fallback
        if (!isSimulating) logMessage(`AI (${player.name}): Strategy PlayLead - Applying fallback lead logic.`);
    }
    // Fallback logic (remains the same)
    if (!validPlays || validPlays.length === 0) { 
        return null; 
    }
    const nonTrumpNonWeliPlaysFiltered = validPlays.filter(card => { if (!card) return false; const isTrump = (trumpSuit && card.suit === trumpSuit); const isWeli = (card.rank === WELI_RANK); return !isTrump && !isWeli; });
    if (nonTrumpNonWeliPlaysFiltered.length > 0) { const sortedNonTrumpNonWeli = _sortCardsByValue(nonTrumpNonWeliPlaysFiltered, null, false); if (sortedNonTrumpNonWeli.length > 0 && sortedNonTrumpNonWeli[0]) { if (!isSimulating) logMessage(`AI (${player.name}): Fallback - Playing highest non-trump, non-Weli: ${sortedNonTrumpNonWeli[0].toString()}.`); return sortedNonTrumpNonWeli[0]; } }
    const sortedTrumpsAsc = _sortCardsByValue(validPlays.filter(c => c), trumpSuit, true);
    if (sortedTrumpsAsc.length > 0 && sortedTrumpsAsc[0]) { if (!isSimulating) logMessage(`AI (${player.name}): Fallback - Only trumps/Weli. Playing LOWEST: ${sortedTrumpsAsc[0].toString()}.`); return sortedTrumpsAsc[0]; }
    if (!isSimulating) logMessage(`AI WARNING (${player.name}): Fallback - Absolute last resort. Playing first valid play: ${validPlays.find(c => c)?.toString()}`);
    return validPlays.find(c => c) || null;
}




// --- Play Follow Decision Function ---
export function decidePlayFollow(player, validPlays, gameState, config) {
    const trumpSuit = gameState.trumpSuit;
    const leadCardPlay = gameState.currentTrick.length > 0 ? gameState.currentTrick[0] : null;
    const leadCard = leadCardPlay ? leadCardPlay.card : null;

    if (leadCard) { 
        const highestCardInTrickSoFar = GameRules.determineTrickWinner(gameState.currentTrick, trumpSuit) ?
                                        gameState.currentTrick.find(p => p.player === GameRules.determineTrickWinner(gameState.currentTrick, trumpSuit)).card :
                                        leadCard; // Should be player object, then get card
        const highestValueInTrick = getCardValue(highestCardInTrickSoFar, trumpSuit);

        const allValidAreTrumpsAndHead = validPlays && validPlays.length >= 2 && validPlays.every(vp => {
            if (!vp) return false; 
            const vpIsTrump = ((trumpSuit && vp.suit === trumpSuit) || vp.rank === WELI_RANK);
            const vpValue = getCardValue(vp, trumpSuit);
            return vpIsTrump && vpValue > highestValueInTrick;
        });

        if (allValidAreTrumpsAndHead) {
            let sortedValidTrumps = _sortCardsByValue(validPlays, trumpSuit, true); 
            if (sortedValidTrumps && sortedValidTrumps.length > 0 && sortedValidTrumps[0]) {
                logMessage(`AI (${player.name}): Strategy PlayFollow - Specific Rule: Must play Trump and head. Multiple options, playing lowest: ${sortedValidTrumps[0].toString()}.`);
                return sortedValidTrumps[0];
            } else {
                logMessage(`AI WARNING (${player.name}): Strategy PlayFollow - Specific Rule: Condition met but sorting failed or yielded no card. Falling through.`);
            }
        }
    }
    logMessage(`AI (${player.name}): Strategy PlayFollow - Entering default logic. validPlays count: ${validPlays ? validPlays.length : 'null'}.`);
    if (validPlays && validPlays.length > 0) {
        if (validPlays.length < 5 || validPlays.some(c => !c)) { 
             logMessage(`AI DEBUG (${player.name}): PlayFollow default - validPlays before sort: ${JSON.stringify(validPlays.map(c => c ? c.key : null))}`);
        }
        let sortedPlays = _sortCardsByValue(validPlays, trumpSuit, true); 
        if (sortedPlays && sortedPlays.length > 0 && sortedPlays[0]) {
            logMessage(`AI (${player.name}): Strategy PlayFollow - Default, playing lowest value valid card: ${sortedPlays[0].toString()}.`);
            return sortedPlays[0];
        } else {
            logMessage(`AI ERROR (${player.name}): Strategy PlayFollow - Default logic: _sortCardsByValue returned empty or invalid array, even though validPlays had ${validPlays.length} items. sortedPlays: ${JSON.stringify(sortedPlays)}.`);
            const firstTrulyValidOriginalCard = validPlays.find(c => c && typeof c.toString === 'function');
            if (firstTrulyValidOriginalCard) {
                 logMessage(`AI (${player.name}): Strategy PlayFollow - ABSOLUTE FALLBACK - playing first truly valid from original validPlays: ${firstTrulyValidOriginalCard.toString()}`);
                 return firstTrulyValidOriginalCard;
            }
            logMessage(`AI CRITICAL (${player.name}): Strategy PlayFollow - No valid card could be determined even with fallbacks.`);
            return null; 
        }
    }
    logMessage(`AI (${player.name}): Strategy PlayFollow - No valid plays array or it's empty. Returning null.`);
    return null; 
}

// --- Generic Discard Decision Function ---
export function decideGenericDiscard(player, cardsToDiscardFrom, countToDiscard, reason, trumpSuit, gameState, config) {
    let handToConsider = [...cardsToDiscardFrom];
    let discards = [];

    // Prioritize keeping trumps, Weli, and the best non-trump Ace.
    let cardsToKeepInitially = handToConsider.filter(card =>
        (trumpSuit && card.suit === trumpSuit && card.rank !== WELI_RANK) || // Non-Weli trumps
        card.rank === WELI_RANK || // Weli
        card.rank === 'A' // All Aces initially
    );

    // If multiple non-trump aces, keep only the highest. Others become potential discards.
    let nonTrumpAcesToKeep = cardsToKeepInitially.filter(card =>
        card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK
    );
    if (nonTrumpAcesToKeep.length > 1) {
        const sortedNonTrumpAces = _sortCardsByValue(nonTrumpAcesToKeep, null, false); // Sort descending
        const bestNonTrumpAce = sortedNonTrumpAces[0];
        // Remove all non-trump aces from initial keep list except the best one
        cardsToKeepInitially = cardsToKeepInitially.filter(card =>
            !(card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK && card.key !== bestNonTrumpAce.key)
        );
    }

    // Cards not in the "to keep" list are candidates for discarding.
    let potentialDiscards = handToConsider.filter(card => !cardsToKeepInitially.some(keep => keep.key === card.key));
    // Sort these potential discards by lowest value first (non-trumps, then low trumps).
    potentialDiscards = _sortCardsByValue(potentialDiscards, trumpSuit, true);

    // Add from potentialDiscards first
    for (let i = 0; i < potentialDiscards.length && discards.length < countToDiscard; i++) {
        discards.push(potentialDiscards[i]);
    }

    // If still need to discard more, start discarding from the "kept" cards (lowest value first from kept).
    if (discards.length < countToDiscard) {
        // Sort the initially kept cards by lowest value (Ace, Weli, Trumps will be higher)
        let sortedKeptCards = _sortCardsByValue(cardsToKeepInitially, trumpSuit, true);
        for (let i = 0; i < sortedKeptCards.length && discards.length < countToDiscard; i++) {
            // Ensure not to re-add something already in discards (shouldn't happen with this logic but good check)
            if (!discards.some(d => d.key === sortedKeptCards[i].key)) {
                discards.push(sortedKeptCards[i]);
            }
        }
    }
    // Slice to ensure exact countToDiscard
    const finalDiscards = discards.slice(0, countToDiscard);
    logMessage(`AI (${player.name}): Strategy Discard (${reason}) - Keeping Trumps/Weli/Best Ace. Discarding ${finalDiscards.length} cards: ${finalDiscards.map(c => c.toString()).join(', ')}.`);
    return finalDiscards;
}



// (Make sure to include the other strategy functions: decideBidStage1, decideBidStage2, _getThreeHighDistinctSuitCards, _countHighCardsInSuits if they were previously elided)
function _getThreeHighDistinctSuitCards(player, trumpSuit) {
    if (!player || !player.hand || player.hand.length < 3) return null;
    const aces = player.hand.filter(c => c.rank === 'A');
    if (aces.length < 2) return null;
    let ace1 = null, ace2 = null;
    if (aces.length === 2 && aces[0].suit !== aces[1].suit) {
        ace1 = aces[0]; ace2 = aces[1];
    } else if (aces.length > 2) {
        for (let i = 0; i < aces.length; i++) {
            for (let j = i + 1; j < aces.length; j++) {
                if (aces[i].suit !== aces[j].suit) {
                    ace1 = aces[i]; ace2 = aces[j]; break;
                }
            }
            if (ace1 && ace2) break;
        }
    }
    if (!ace1 || !ace2) return null;
    const highRanks = ['O', 'K', 'A'];
    const thirdHighCard = player.hand.find(card =>
        card.key !== ace1.key && card.key !== ace2.key &&
        highRanks.includes(card.rank) &&
        card.suit !== ace1.suit && card.suit !== ace2.suit
    );
    if (!thirdHighCard) return null;
    const keyCards = [ace1, ace2, thirdHighCard];
    const oneIsTrump = keyCards.some(kc => (trumpSuit && kc.suit === trumpSuit) || kc.rank === WELI_RANK);
    return { keyCards: keyCards, oneIsTrump: oneIsTrump };
}


// --- Bidding Stage 1 Decision Function (UPDATED) ---
export function decideBidStage1(player, validBids, gameState, config) {
    const trumpSuit = gameState.trumpSuit;
    const hasTrumpAce = _hasCard(player, 'A', trumpSuit);
    const hasWeli = _hasCard(player, WELI_RANK);
    const numTrumps = _countTrumps(player, trumpSuit);
    player.aiPlan = {}; 

    // --- Standard Sneak Bidding Logic (Unchanged) ---
    if (hasTrumpAce && hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        logMessage(`AI (${player.name}): Strategy Bid1 - Has Trump Ace and Weli. Bidding SNEAK.`);
        return BID_OPTIONS.SNEAK;
    }
    if (hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        const otherHighTrumpsXPlus = _getTrumpCards(player, trumpSuit)
            .filter(card => {
                if (card.rank === WELI_RANK) return false; 
                const rankIndex = RANKS.indexOf(card.rank);
                const tenIndex = RANKS.indexOf('X');
                return rankIndex >= tenIndex;
            });
        if (otherHighTrumpsXPlus.length >= 2) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli AND >=2 other trumps (rank 'X' or higher). Bidding SNEAK.`);
            return BID_OPTIONS.SNEAK;
        }
    }
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        const furtherTrumps = _getTrumpCards(player, trumpSuit)
            .filter(card => !(card.rank === 'A' && card.suit === trumpSuit));
        if (furtherTrumps.length >= 2) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Ace of Trump AND >=2 further trumps. Bidding SNEAK.`);
            return BID_OPTIONS.SNEAK;
        }
    }
    if (hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        const furtherTrumpsFromWeli = _getTrumpCards(player, trumpSuit)
            .filter(card => card.rank !== WELI_RANK); 
        if (furtherTrumpsFromWeli.length >= 2) {
            const oberIndex = RANKS.indexOf('O');
            const hasOberPlusAmongFurther = furtherTrumpsFromWeli.some(card => {
                const rankIndex = RANKS.indexOf(card.rank);
                return rankIndex >= oberIndex;
            });
            if (hasOberPlusAmongFurther) {
                logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli AND >=2 further trumps (at least one Ober+). Bidding SNEAK.`);
                return BID_OPTIONS.SNEAK;
            }
        }
    }
    if (numTrumps >= 4 && validBids.includes(BID_OPTIONS.SNEAK)) {
        logMessage(`AI (${player.name}): Strategy Bid1 - Has ${numTrumps} Trumps (>=4 total). Bidding SNEAK.`);
        return BID_OPTIONS.SNEAK;
    }
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        const companionTrumps = _getTrumpCardsWithValueOrHigher(player, trumpSuit, config.bidStage1.minCompanionTrumpValueForSneak, RANKS)
            .filter(c => !(hasWeli && c.rank === WELI_RANK && c.key === player.hand.find(hCard => hCard.rank === WELI_RANK)?.key) && 
                           !(c.rank === 'A' && c.suit === trumpSuit) 
            );
        const neededCompanions = (hasWeli && hasTrumpAce) ? 0 : 1;
        if (companionTrumps.length >= neededCompanions) {
             if (neededCompanions > 0 && companionTrumps.length > 0) { 
                logMessage(`AI (${player.name}): Strategy Bid1 - Has Trump Ace and high companion Trump (${companionTrumps.map(c=>c.toString())}). Bidding SNEAK.`);
                return BID_OPTIONS.SNEAK;
             }
        }
    }

    // --- NEW "4 auf die Sau" Logic (Replaces old random chance logic) ---
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        let isEffectivelySoloAce = false;
        const trumpsInHand = _getTrumpCards(player, trumpSuit);
        if (trumpsInHand.length === 1 && trumpsInHand[0].rank === 'A' && trumpsInHand[0].suit === trumpSuit) {
            isEffectivelySoloAce = true; 
        } else if (trumpsInHand.length === 2 && hasWeli) {
            const aceIsPresent = trumpsInHand.some(t => t.rank === 'A' && t.suit === trumpSuit);
            const weliIsPresentAmongTrumps = trumpsInHand.some(t => t.rank === WELI_RANK);
            if (aceIsPresent && weliIsPresentAmongTrumps) {
                isEffectivelySoloAce = true; 
            }
        }

        if(isEffectivelySoloAce) {
            // Calculate player's bidding position (1-4)
            const playerCount = gameState.players.length;
            const forehandIndex = (gameState.dealerIndex + 1) % playerCount;
            const myOffset = (player.id - forehandIndex + playerCount) % playerCount;
            const biddingPosition = myOffset + 1; // 1 = forehand, 4 = rearhand

            let chance = 0.0;
            if (biddingPosition === 3) {
                chance = 0.3; // 30% chance
            } else if (biddingPosition === 4) {
                chance = 0.8; // 80% chance
            }
            // Positions 1 and 2 have a 0% chance

            const willSneak = Math.random() < chance;
            logMessage(`AI (${player.name}): Strategy Bid1 (Sau) - Solo Ace hand. Position: ${biddingPosition}/${playerCount}. Chance: ${chance*100}%. Result: ${willSneak ? 'SNEAK' : 'No Sneak'}.`);

            if (willSneak) {
               player.aiPlan.intendSau = true;
               logMessage(`AI (${player.name}): Bidding SNEAK. Intending "4 auf die Sau".`);
               return BID_OPTIONS.SNEAK;
            }
        }
    }


    // --- Oder/Weiter Fallback Logic (Unchanged) ---
    if (!gameState.oderPlayer) {
        const threeHighInfo = _getThreeHighDistinctSuitCards(player, trumpSuit);
        if (threeHighInfo) {
            if (threeHighInfo.oneIsTrump && validBids.includes(BID_OPTIONS.ODER_MIT)) {
                logMessage(`AI (${player.name}): Strategy Bid1 - Has 2 Aces + high third in distinct suits, one IS TRUMP. Bidding ODER MIT.`);
                return BID_OPTIONS.ODER_MIT;
            } else if (!threeHighInfo.oneIsTrump && validBids.includes(BID_OPTIONS.ODER_OHNE)) {
                logMessage(`AI (${player.name}): Strategy Bid1 - Has 2 Aces + high third in distinct suits, NONE ARE TRUMP. Bidding ODER OHNE.`);
                return BID_OPTIONS.ODER_OHNE;
            }
        }
    }
    if (!gameState.oderPlayer && hasWeli) {
        const hasWeliPlusAnotherTrump = numTrumps >= 2;
        if (hasWeliPlusAnotherTrump && validBids.includes(BID_OPTIONS.ODER_MIT)) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli AND at least one OTHER trump (total trumps >= 2). Bidding ODER MIT.`);
            return BID_OPTIONS.ODER_MIT;
        } else if (validBids.includes(BID_OPTIONS.ODER_OHNE)) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli but NOT Weli+another_trump. Bidding ODER OHNE.`);
            return BID_OPTIONS.ODER_OHNE;
        }
    }
    const nonTrumpAces = _getNonTrumpAces(player, trumpSuit);
    if (!gameState.oderPlayer && hasWeli && nonTrumpAces.length > 0 && validBids.includes(BID_OPTIONS.ODER_OHNE)) {
        logMessage(`AI (${player.name}): Strategy Bid1 (Fallback) - Has Weli and non-Trump Ace. Bidding ODER OHNE.`);
        return BID_OPTIONS.ODER_OHNE;
    }
    if (!gameState.oderPlayer && hasWeli && nonTrumpAces.length > 0 &&
        _getTrumpCardsWithValueOrHigher(player, trumpSuit, config.bidStage1.minTrumpForOderMit, RANKS).filter(c => c.rank !== WELI_RANK).length >= 1 &&
        validBids.includes(BID_OPTIONS.ODER_MIT)) {
        logMessage(`AI (${player.name}): Strategy Bid1 (Fallback) - Has Weli, high companion Trump, and non-Trump Ace. Bidding ODER MIT.`);
        return BID_OPTIONS.ODER_MIT;
    }
    if (!gameState.oderPlayer && nonTrumpAces.length >= 2 && validBids.includes(BID_OPTIONS.ODER_OHNE)) {
        logMessage(`AI (${player.name}): Strategy Bid1 (Fallback) - Has >=2 non-Trump Aces. Bidding ODER OHNE.`);
        return BID_OPTIONS.ODER_OHNE;
    }
    if (validBids.includes(BID_OPTIONS.WEITER)) {
        logMessage(`AI (${player.name}): Strategy Bid1 - No specific Sneak/Oder condition met. Bidding WEITER.`);
        return BID_OPTIONS.WEITER;
    }
    logMessage(`AI (${player.name}): Strategy Bid1 - Fallback, choosing first valid bid: ${validBids.length > 0 ? validBids[0] : 'None'}.`);
    return validBids.length > 0 ? validBids[0] : null;
}


function _countHighCardsInSuits(player, minRank = 'X') {
    if (!player || !player.hand) return { count: 0, suits: new Set() };
    const highRankIndex = RANKS.indexOf(minRank);
    if (highRankIndex === -1) return { count: 0, suits: new Set() }; 
    const suitsWithHighCard = new Set();
    for (const suit of SUITS) { 
        const suitCards = player.hand.filter(card => card.suit === suit);
        const hasHighCardInSuit = suitCards.some(card => {
            const cardRankIndex = RANKS.indexOf(card.rank);
            return cardRankIndex >= highRankIndex;
        });
        if (hasHighCardInSuit) {
            suitsWithHighCard.add(suit);
        }
    }
    return { count: suitsWithHighCard.size, suits: suitsWithHighCard };
}



//  HELPER FUNCTION: To evaluate a hand's potential when the trump suit is unknown.
function _evaluateHandForOder(player, gameState) {
    let score = 0;
    let logParts = [];

    // 1. Guaranteed Strength (Trump-Agnostic Assets)
    if (_hasCard(player, WELI_RANK)) {
        score += 12; // The Weli is the most valuable card in this situation.
        logParts.push("Weli:+12");
    }
    const aces = player.hand.filter(c => c.rank === 'A');
    score += aces.length * 6; // Each Ace is a very strong asset.
    if (aces.length > 0) logParts.push(`Aces:${aces.length * 6}`);

    // 2. Potential Strength (Suit Quality and Voids)
    let suitPotentials = [];
    const highCardRanks = { 'K': 3, 'O': 2, 'U': 1, 'X': 1 }; // Bonus values for high cards

    SUITS.forEach(suit => {
        const cardsInSuit = _getCardsOfSuit(player, suit);
        let suitScore = 0;
        // Bonus for length
        if (cardsInSuit.length === 2) suitScore += 2;
        if (cardsInSuit.length === 3) suitScore += 5;
        if (cardsInSuit.length >= 4) suitScore += 8;
        // Bonus for high cards within the suit
        cardsInSuit.forEach(card => {
            if (highCardRanks[card.rank]) {
                suitScore += highCardRanks[card.rank];
            }
        });
        suitPotentials.push(suitScore);

        // Bonus for void suits
        if (cardsInSuit.length === 0) {
            score += 1;
            logParts.push("Void:+1");
        }
    });

    const bestSuitPotential = Math.max(...suitPotentials);
    score += bestSuitPotential;
    if (bestSuitPotential > 0) logParts.push(`SuitPoten.:${bestSuitPotential}`);

    // 3. Strategic Context (Bidding Position)
    const biddingOrder = [];
    let tempTurn = gameState.nextPlayerIndex(gameState.oderPlayer.id);
    for (let i = 0; i < gameState.players.length; i++) {
        const p = gameState.players[tempTurn];
        if (p !== gameState.oderPlayer && p.status !== PLAYER_STATUS.FOLDED) {
            biddingOrder.push(p);
        }
        tempTurn = gameState.nextPlayerIndex(tempTurn);
    }

    const myPosition = biddingOrder.findIndex(p => p.id === player.id);
    if (myPosition === 0 && biddingOrder.length > 1) {
        score -= 2; // Penalty for being first to decide with limited info.
        logParts.push("Pos.Pen.:-2");
    }
    if (myPosition === biddingOrder.length - 1) {
        const partnersJoined = gameState.players.filter(p => p.status === PLAYER_STATUS.ACTIVE_PLAYER && p.id !== player.id).length;
        if (partnersJoined === 0) {
            score += 5; // Strong incentive to "save" the game.
            logParts.push("SaveBonus:+5");
        }
    }

    logMessage(`AI (${player.name}): Oder Hand Eval: ${score.toFixed(0)} [${logParts.join(', ')}]`);
    return score;
}



export function decideBidStage2(player, validBids, gameState, config) {
    const isSimulating = config.isSimulationRunning;

    // --- Case 1: Joining a Sneaker (Trump is known) ---
    if (gameState.sneaker) {
        // This is the existing, unchanged logic for joining a Sneaker
        let score = 0;
        let logParts = [];
        const trumpSuit = gameState.trumpSuit;
        if (!trumpSuit) {
            if (!isSimulating) logMessage(`AI ERROR (${player.name}): Cannot evaluate hand for Sneaker, trump suit is unknown!`);
            return validBids.includes(BID_OPTIONS.FOLD) ? BID_OPTIONS.FOLD : validBids[0];
        }
        const trumpValues = { 'W': 10, 'A': 10, 'K': 6, 'O': 5, 'U': 4, 'X': 3, '9': 1, '8': 1, '7': 1 };
        const myTrumps = _getTrumpCards(player, trumpSuit);
        let trumpBaseScore = 0;
        myTrumps.forEach(card => {
            const rank = card.rank === WELI_RANK ? 'W' : (card.suit === trumpSuit ? card.rank : null);
            if (rank && trumpValues[rank]) trumpBaseScore += trumpValues[rank];
        });
        score += trumpBaseScore;
        if (trumpBaseScore > 0) logParts.push(`trumps:${trumpBaseScore}`);
        const numTrumps = myTrumps.length;
        let lengthBonus = 0;
        if (numTrumps === 2) lengthBonus = 3; else if (numTrumps === 3) lengthBonus = 5; else if (numTrumps >= 4) lengthBonus = 8;
        score += lengthBonus;
        if (lengthBonus > 0) logParts.push(`lenBonus:${lengthBonus}`);
        let voidSuitBonus = 0;
        const nonTrumpSuits = SUITS.filter(s => s !== trumpSuit);
        nonTrumpSuits.forEach(suit => { if (_getCardsOfSuit(player, suit).length === 0) voidSuitBonus += 1; });
        score += voidSuitBonus;
        if (voidSuitBonus > 0) logParts.push(`voidBonus:${voidSuitBonus}`);

        const threshold = config.bidStage2.minHandValueToPlayWithSneaker || 8;
        const decision = score >= threshold;
        if (!isSimulating) logMessage(`AI (${player.name}): Strategy Bid2 (Sneaker) - Hand Value: ${score.toFixed(0)} [${logParts.join(', ')}] vs Threshold: ${threshold}. Decision: ${decision ? 'PLAY' : 'FOLD'}`);
        if (decision && validBids.includes(BID_OPTIONS.PLAY)) return BID_OPTIONS.PLAY;

    // --- Case 2: Joining an Oderer (Trump is UNKNOWN) ---
    } else if (gameState.oderPlayer) {
        const score = _evaluateHandForOder(player, gameState);
        const threshold = config.bidStage2.minHandValueToPlayWithOderer || 10; // Use new threshold
        const decision = score >= threshold;

        if (!isSimulating) {
            logMessage(`AI (${player.name}): Strategy Bid2 (Oder) - Hand Value: ${score.toFixed(0)} vs Threshold: ${threshold}. Decision: ${decision ? 'PLAY' : 'FOLD'}`);
        }
        if (decision && validBids.includes(BID_OPTIONS.PLAY)) {
            return BID_OPTIONS.PLAY;
        }

    // --- Fallback ---
    } else {
        if (!isSimulating) logMessage(`AI (${player.name}): Strategy Bid2 - Neither Sneaker nor Oderer found. Folding.`);
    }

    // Default to Fold if any condition fails or isn't met
    if (validBids.includes(BID_OPTIONS.FOLD)) {
        return BID_OPTIONS.FOLD;
    }
    return validBids[0]; // Absolute fallback
}