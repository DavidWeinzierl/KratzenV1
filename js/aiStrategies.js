// js/aiStrategies.js

import { BID_OPTIONS, EXCHANGE_TYPE, RANKS, WELI_RANK, SUITS, getCardValue, PLAYER_STATUS } from './constants.js';
import { logMessage } from './logger.js'; // Import logMessage
import { GameRules } from './gameLogic.js';

// --- Helper Functions (Internal to this module or could be moved to a utility file) ---
// (Helper functions remain the same as in the previous version - not repeated here for brevity)

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
    if (!player || !player.hand || !trumpSuit || !minRank) return [];
    const minRankIndex = ranksOrder.indexOf(minRank);
    if (minRankIndex === -1) return _getTrumpCards(player, trumpSuit);

    return _getTrumpCards(player, trumpSuit).filter(card => {
        if (card.rank === WELI_RANK) return true;
        const cardRankIndex = ranksOrder.indexOf(card.rank);
        return cardRankIndex >= minRankIndex;
    });
}

function _getNonTrumpAces(player, trumpSuit) {
    if (!player || !player.hand) return [];
    return player.hand.filter(card => card.rank === 'A' && card.suit !== trumpSuit && card.rank !== WELI_RANK);
}

function _isLastToBid(gameState, player, stage1 = true) {
    const activeBidders = gameState.players.filter(p => {
        if (p.status === PLAYER_STATUS.FOLDED) return false;
        // In stage 1, anyone who hasn't bid.
        // In stage 2, anyone who hasn't bid AND is not the sneaker.
        if (p.hasBid) return false;
        if (!stage1 && gameState.sneaker && p.id === gameState.sneaker.id) return false;
        return true;
    });

    if (activeBidders.length === 0) return false;

    let turnOrder = [];
    let currentTurn = gameState.turnPlayerIndex;
    let initialTurn = gameState.turnPlayerIndex; // To detect full loop

    // Build the order of players yet to bid, starting from current turn player
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
    return true; // Simplified: checks if *this* player is already sneaker/oder or no one is
}


function _playersJoinedGame(gameState) {
    return gameState.players.filter(p => p.status === PLAYER_STATUS.ACTIVE_PLAYER || p.status === PLAYER_STATUS.ACTIVE_SNEAKER).length;
}

// js/aiStrategies.js

// ... (other imports and helper functions like _hasCard, etc.)
// Make sure getCardValue is robust (as discussed before, in constants.js)
// import { getCardValue } from './constants.js'; // If not already available

function _sortCardsByValue(cards, trumpSuit, ascending = true) {
    if (!cards || !Array.isArray(cards)) {
        logMessage(`_sortCardsByValue: Input 'cards' is not a valid array. Received: ${JSON.stringify(cards)}`);
        return [];
    }

    // Filter out null, undefined, or objects that don't look like cards before sorting
    const cleanCards = cards.filter(card => {
        if (!card || typeof card.rank === 'undefined' || typeof card.suit === 'undefined') {
            // logMessage(`_sortCardsByValue: Filtering out invalid item: ${JSON.stringify(card)}`);
            return false;
        }
        return true;
    });

    if (cleanCards.length === 0) {
        // logMessage(`_sortCardsByValue: No valid cards to sort after cleaning. Original count: ${cards.length}`);
        return [];
    }

    return cleanCards.sort((a, b) => {
        // getCardValue should be robust and always return a number
        const valA = getCardValue(a, trumpSuit);
        const valB = getCardValue(b, trumpSuit);

        // Safety check if getCardValue somehow still produced non-numbers
        if (typeof valA !== 'number' || isNaN(valA)) {
            // logMessage(`_sortCardsByValue: Card A (${a?.toString()}) had invalid value ${valA}. Treating as ${ascending ? 'highest' : 'lowest'}.`);
            return ascending ? 1 : -1; // Push problematic items to one end
        }
        if (typeof valB !== 'number' || isNaN(valB)) {
            // logMessage(`_sortCardsByValue: Card B (${b?.toString()}) had invalid value ${valB}. Treating as ${ascending ? 'lowest' : 'highest'}.`);
            return ascending ? -1 : 1;
        }

        return ascending ? valA - valB : valB - valA;
    });
}

// --- Bidding Stage 1 Decision Function ---

// js/aiStrategies.js
// ... (imports and existing helper functions like _hasCard, _getCardsOfSuit, _getTrumpCards, _getNonTrumpAces, _isLastToBid, _noOneElseBidSneakOrOder etc.)

// Helper to check for the "Three High Cards (2 Aces + Ober in different suits)"
function _getThreeHighDistinctSuitCards(player, trumpSuit) {
    if (!player || !player.hand || player.hand.length < 3) return null;

    const aces = player.hand.filter(c => c.rank === 'A');
    if (aces.length < 2) return null;

    // Find two aces of different suits if possible
    let ace1 = null, ace2 = null;
    if (aces.length === 2 && aces[0].suit !== aces[1].suit) {
        ace1 = aces[0];
        ace2 = aces[1];
    } else if (aces.length > 2) {
        // Try to find two aces of different suits among the multiple aces
        for (let i = 0; i < aces.length; i++) {
            for (let j = i + 1; j < aces.length; j++) {
                if (aces[i].suit !== aces[j].suit) {
                    ace1 = aces[i];
                    ace2 = aces[j];
                    break;
                }
            }
            if (ace1 && ace2) break;
        }
    }
    if (!ace1 || !ace2) return null; // Couldn't find two aces of different suits

    // Find a third high card (Ober, King, or another Ace) NOT of the same suit as ace1 or ace2
    const highRanks = ['O', 'K', 'A'];
    const thirdHighCard = player.hand.find(card =>
        card.key !== ace1.key &&
        card.key !== ace2.key &&
        highRanks.includes(card.rank) &&
        card.suit !== ace1.suit &&
        card.suit !== ace2.suit
    );

    if (!thirdHighCard) return null;

    const keyCards = [ace1, ace2, thirdHighCard];
    // Check if one of these key cards is a trump
    const oneIsTrump = keyCards.some(kc => (trumpSuit && kc.suit === trumpSuit) || kc.rank === WELI_RANK);

    return {
        keyCards: keyCards, // The three specific cards forming the pattern
        oneIsTrump: oneIsTrump // Boolean: is one of these three a trump?
    };
}


export function decideBidStage1(player, validBids, gameState, config) {
    const trumpSuit = gameState.trumpSuit;
    const hasTrumpAce = _hasCard(player, 'A', trumpSuit);
    const hasWeli = _hasCard(player, WELI_RANK);
    const numTrumps = _countTrumps(player, trumpSuit);
    // const nonTrumpAces = _getNonTrumpAces(player, trumpSuit); // May still be useful for fallback logic

    player.aiPlan = {}; // Reset any previous plan

     // --- SNEAK BIDS (Order of checks matters for precedence) ---

    // 1. Strongest: Ace of Trump + Weli
    if (hasTrumpAce && hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        logMessage(`AI (${player.name}): Strategy Bid1 - Has Trump Ace and Weli. Bidding SNEAK.`);
        return BID_OPTIONS.SNEAK;
    }

    // 2. Weli + 2 other high trumps (Rank 'X' or higher)
    if (hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        const otherHighTrumpsXPlus = _getTrumpCards(player, trumpSuit)
            .filter(card => {
                if (card.rank === WELI_RANK) return false; // Exclude Weli itself
                const rankIndex = RANKS.indexOf(card.rank);
                const tenIndex = RANKS.indexOf('X');
                return rankIndex >= tenIndex;
            });
        if (otherHighTrumpsXPlus.length >= 2) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli AND >=2 other trumps (rank 'X' or higher). Bidding SNEAK.`);
            return BID_OPTIONS.SNEAK;
        }
    }

    // --- NEW SNEAK CONDITION 1: Ace of Trump + 2 further trumps ---
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        // Get all trumps, then exclude the Ace of Trump itself to count "further trumps"
        const furtherTrumps = _getTrumpCards(player, trumpSuit)
            .filter(card => !(card.rank === 'A' && card.suit === trumpSuit));

        if (furtherTrumps.length >= 2) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Ace of Trump AND >=2 further trumps. Bidding SNEAK.`);
            return BID_OPTIONS.SNEAK;
        }
    }
    // --- END NEW SNEAK CONDITION 1 ---

    // --- NEW SNEAK CONDITION 2: Weli + 2 further trumps (one being Ober+) ---
    if (hasWeli && validBids.includes(BID_OPTIONS.SNEAK)) {
        const furtherTrumpsFromWeli = _getTrumpCards(player, trumpSuit)
            .filter(card => card.rank !== WELI_RANK); // Get trumps other than Weli

        if (furtherTrumpsFromWeli.length >= 2) {
            // Check if at least one of these "further trumps" is Ober or higher
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
    // --- END NEW SNEAK CONDITION 2 ---

    // 3. Existing Sneak: 4 Trumps (overall count)
    if (numTrumps >= 4 && validBids.includes(BID_OPTIONS.SNEAK)) {
        // This check considers the total number of trumps, which might include Ace/Weli.
        // It acts as a good general strong hand indicator if more specific combos above aren't met.
        logMessage(`AI (${player.name}): Strategy Bid1 - Has ${numTrumps} Trumps (>=4 total). Bidding SNEAK.`);
        return BID_OPTIONS.SNEAK;
    }

    // 4. Existing Sneak: Trump Ace + (another) high companion trump (from config)
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        // Filter out Weli if it's already part of the Ace+Weli check, to find a *different* companion
        const companionTrumps = _getTrumpCardsWithValueOrHigher(player, trumpSuit, config.bidStage1.minCompanionTrumpValueForSneak, RANKS)
            .filter(c => !(hasWeli && c.rank === WELI_RANK && c.key === player.hand.find(hCard => hCard.rank === WELI_RANK)?.key) && // not the Weli if Weli+Ace handled
                           !(c.rank === 'A' && c.suit === trumpSuit) // not the Ace of Trump itself
            );

        // If Ace+Weli is already a combo, we don't need another companion.
        // Otherwise, we need at least one companion.
        const neededCompanions = (hasWeli && hasTrumpAce) ? 0 : 1;
        if (companionTrumps.length >= neededCompanions) {
             if (neededCompanions > 0 && companionTrumps.length > 0) { // Log only if it found a distinct companion
                logMessage(`AI (${player.name}): Strategy Bid1 - Has Trump Ace and high companion Trump (${companionTrumps.map(c=>c.toString())}). Bidding SNEAK.`);
                return BID_OPTIONS.SNEAK;
             } else if (neededCompanions === 0 && hasWeli && hasTrumpAce) {
                 // This case is already covered by the first Ace+Weli check, but for logical completeness
                 // if somehow the first check was bypassed.
                 // logMessage(`AI (${player.name}): Strategy Bid1 - Ace+Weli sufficient, no further companion needed. (Redundant Check)`);
                 // return BID_OPTIONS.SNEAK; // Already returned if this was true
             }
        }
    }
    
    // 5. Existing Sneak: Solo Trump Ace (with refined logic for Weli)
    if (hasTrumpAce && validBids.includes(BID_OPTIONS.SNEAK)) {
        let isEffectivelySoloAce = false;
        // Check if Ace is the ONLY trump, OR if Ace + Weli are the only trumps (and Weli is acting as a trump)
        const trumpsInHand = _getTrumpCards(player, trumpSuit);
        if (trumpsInHand.length === 1 && trumpsInHand[0].rank === 'A' && trumpsInHand[0].suit === trumpSuit) {
            isEffectivelySoloAce = true; // Ace is literally the only trump
        } else if (trumpsInHand.length === 2 && hasWeli) {
            const aceIsPresent = trumpsInHand.some(t => t.rank === 'A' && t.suit === trumpSuit);
            const weliIsPresentAmongTrumps = trumpsInHand.some(t => t.rank === WELI_RANK);
            if (aceIsPresent && weliIsPresentAmongTrumps) {
                isEffectivelySoloAce = true; // Only Ace of Trump and Weli are the trumps
            }
        }

        if(isEffectivelySoloAce) {
            let shouldSneak = false;
            let reason = "";
            if (Math.random() < config.bidStage1.soloTrumpAceSneakChance) {
                shouldSneak = true; reason = "by random chance";
            }
            if (!shouldSneak && config.bidStage1.alwaysSneakIfLastAndNoBid && _isLastToBid(gameState, player, true) && _noOneElseBidSneakOrOder(gameState, player)) {
                shouldSneck = true; reason = "as last to bid and no prior Sneak/Oder";
            }
            if (shouldSneak) {
               player.aiPlan.intendSau = true;
               logMessage(`AI (${player.name}): Strategy Bid1 - Effectively solo Trump Ace (possibly with Weli). Bidding SNEAK (${reason}). Intending "4 auf die Sau".`);
               return BID_OPTIONS.SNEAK;
            }
        }
    }

     // --- NEW ODER STRATEGIES (Checked if Sneak criteria not met) ---

    // 1. Three High Distinct Suit Cards (2 Aces + Ober/King/Ace)
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

    // 2. Weli-driven Oder (REVISED LOGIC)
    if (!gameState.oderPlayer && hasWeli) {
        // Condition for "Oder Mit": Player has Weli AND at least one OTHER trump card.
        // This means numTrumps (which includes Weli if it's a trump) must be >= 2.
        const hasWeliPlusAnotherTrump = numTrumps >= 2;

        if (hasWeliPlusAnotherTrump && validBids.includes(BID_OPTIONS.ODER_MIT)) {
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli AND at least one OTHER trump (total trumps >= 2). Bidding ODER MIT.`);
            return BID_OPTIONS.ODER_MIT;
        } else if (validBids.includes(BID_OPTIONS.ODER_OHNE)) {
            // If "Oder Mit" condition (Weli + another trump) is NOT met, but player has Weli,
            // then they should go for "Oder Ohne".
            // This covers:
            //    a) Weli is the ONLY trump card (e.g., Weli is Bells, Bells is trump, no other trumps).
            //    b) Weli is present, but NO card (including Weli itself if Bells isn't trump) is a trump.
            logMessage(`AI (${player.name}): Strategy Bid1 - Has Weli but NOT Weli+another_trump. Bidding ODER OHNE.`);
            return BID_OPTIONS.ODER_OHNE;
        }
    }
    // --- ORIGINAL/FALLBACK ODER BIDS ---
    // ... (Fallback Oder logic as before, _getNonTrumpAces might be calculated if needed here) ...
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



    // --- DEFAULT: WEITER ---
    if (validBids.includes(BID_OPTIONS.WEITER)) {
        logMessage(`AI (${player.name}): Strategy Bid1 - No specific Sneak/Oder condition met. Bidding WEITER.`);
        return BID_OPTIONS.WEITER;
    }

    // Absolute fallback if Weiter is somehow not valid (should not happen)
    logMessage(`AI (${player.name}): Strategy Bid1 - Fallback, choosing first valid bid: ${validBids.length > 0 ? validBids[0] : 'None'}.`);
    return validBids.length > 0 ? validBids[0] : null;
}


// --- Bidding Stage 2 Decision Function ---


// Helper specifically for the new Oder Stage 2 logic
function _countHighCardsInSuits(player, minRank = 'X') {
    if (!player || !player.hand) return { count: 0, suits: new Set() };

    const highRankIndex = RANKS.indexOf(minRank);
    if (highRankIndex === -1) return { count: 0, suits: new Set() }; // Invalid minRank

    let highSuitCount = 0;
    const suitsWithHighCard = new Set();

    for (const suit of SUITS) { // Iterate through all standard suits
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


export function decideBidStage2(player, validBids, gameState, config) {
    // const trumpSuit = gameState.trumpSuit; // Trump suit is NOT known yet if it's an Oder game
    const hasWeli = _hasCard(player, WELI_RANK); // Weli is always known

    const isJoiningRealSneaker = gameState.sneaker && player !== gameState.sneaker && !gameState.oderPlayer;
    const isJoiningPendingOderer = gameState.oderPlayer && player !== gameState.oderPlayer; // Oder is pending

    if (isJoiningRealSneaker) { // Standard Sneaker game, trump is known
        const trumpSuit = gameState.trumpSuit; // Trump IS known here
        logMessage(`AI (${player.name}): Strategy Bid2 - Sneaker (${gameState.sneaker.name}) is set (direct Sneak). Trump: ${trumpSuit}. Considering Play/Fold.`);
        if (hasWeli && validBids.includes(BID_OPTIONS.PLAY)) {
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Sneaker) - Has Weli. Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }
        const highTrumps = _getTrumpCardsWithValueOrHigher(player, trumpSuit, config.bidStage2.minTrumpValueToPlayWithSneaker, RANKS);
        if (highTrumps.length > 0 && validBids.includes(BID_OPTIONS.PLAY)) {
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Sneaker) - Has high Trump(s). Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }
        // ... (rest of existing logic for joining a direct Sneaker)
        const otherTrumps = _getTrumpCards(player, trumpSuit).filter(t => !highTrumps.includes(t) && t.rank !== WELI_RANK);
        if (otherTrumps.length > 0 && validBids.includes(BID_OPTIONS.PLAY)) {
            if (Math.random() < config.bidStage2.lowTrumpPlayChanceWithSneaker) {
                logMessage(`AI (${player.name}): Strategy Bid2 (vs Sneaker) - Has low Trump(s), random chance met. Bidding PLAY.`);
                return BID_OPTIONS.PLAY;
            } else {
                logMessage(`AI (${player.name}): Strategy Bid2 (vs Sneaker) - Has low Trump(s), random chance NOT met for PLAY.`);
            }
        }
        const activePlayersBesidesSneaker = gameState.players.filter(p => p.status === PLAYER_STATUS.ACTIVE_PLAYER && p !== gameState.sneaker);
        if (config.bidStage2.playIfLastAndNoOneJoined && _isLastToBid(gameState, player, false) && activePlayersBesidesSneaker.length === 0 && validBids.includes(BID_OPTIONS.PLAY)) {
            player.aiPlan.intendPackerlIfLastJoin = true;
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Sneaker) - Last to bid, no one joined Sneaker. Bidding PLAY. Intending Packerl.`);
            return BID_OPTIONS.PLAY;
        }

    } else if (isJoiningPendingOderer) {
        logMessage(`AI (${player.name}): Strategy Bid2 - Oder by ${gameState.oderPlayer.name} is PENDING. Trump UNKNOWN. Considering Play/Fold.`);

        // Rule 1: 3 different suits with cards >= 'X' (10)
        const highSuitInfo = _countHighCardsInSuits(player, 'X'); // Assuming 'X' is rank for 10
        if (highSuitInfo.count >= 3 && validBids.includes(BID_OPTIONS.PLAY)) {
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Oderer) - Has >=3 suits with cards rank 'X' or higher. Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }

        // Rule 2: 2 Aces (non-trump, as trump isn't known; Weli is not an Ace)
        // We can't know non-trump Aces for sure, so we count all Aces.
        // If Weli happens to be an Ace (not per rules but for safety), it's still strong.
        const acesInHand = player.hand.filter(card => card.rank === 'A');
        if (acesInHand.length >= 2 && validBids.includes(BID_OPTIONS.PLAY)) {
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Oderer) - Has ${acesInHand.length} Aces. Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }
        // Optional: Add Weli check for Oderer context if desired (e.g., always play with Weli)
        if (hasWeli && validBids.includes(BID_OPTIONS.PLAY)) {
            // This makes Weli a strong reason to play even if other conditions aren't met for Oder
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Oderer) - Has Weli. Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }


        // Fallback: Play if last and no one joined (if config allows)
        const activePlayersBesidesOderer = gameState.players.filter(p => p.status === PLAYER_STATUS.ACTIVE_PLAYER && p !== gameState.oderPlayer);
        if (config.bidStage2.playIfLastAndNoOneJoined && _isLastToBid(gameState, player, false) && activePlayersBesidesOderer.length === 0 && validBids.includes(BID_OPTIONS.PLAY)) {
            logMessage(`AI (${player.name}): Strategy Bid2 (vs Oderer) - Last to bid, no one joined Oderer. Bidding PLAY.`);
            return BID_OPTIONS.PLAY;
        }

    } else {
        // This case means the current player IS the Sneaker or OderPlayer, or it's not a typical join scenario.
        // Bidding Stage 2 is for *other* players to join. The Sneaker/OderPlayer themselves don't make a Play/Fold bid.
        // So, if this AI is the Sneaker/OderPlayer, it shouldn't be called in Stage 2 for a Play/Fold decision.
        // If it's some other unexpected state, log it and default to Fold.
        logMessage(`AI WARNING (${player.name}): Strategy Bid2 - Unexpected context. Not joining Sneaker or Oderer. Player status: ${player.status}. Sneaker: ${gameState.sneaker?.name}, Oderer: ${gameState.oderPlayer?.name}`);
    }


    // Default: Fold if no positive condition met
    if (validBids.includes(BID_OPTIONS.FOLD)) {
        logMessage(`AI (${player.name}): Strategy Bid2 - No PLAY condition met or not in a join context. Bidding FOLD.`);
        return BID_OPTIONS.FOLD;
    }

    logMessage(`AI (${player.name}): Strategy Bid2 - Fallback, choosing first valid bid: ${validBids.length > 0 ? validBids[0] : 'None'}.`);
    return validBids.length > 0 ? validBids[0] : null;
}

// ... (rest of aiStrategies.js)

// --- Exchange Phase Decision Function ---
export function decideExchange(player, validExchangeOptions, trumpSuit, gameState, config) {
    const hasWeli = _hasCard(player, WELI_RANK);
    const trumpCards = _getTrumpCards(player, trumpSuit);
    const numTrumps = trumpCards.length;

    if (player.aiPlan && player.aiPlan.intendSau && config.exchange.considerSauIfPlanned) {
        const sauOption = validExchangeOptions.find(opt => opt.type === EXCHANGE_TYPE.SAU);
        if (sauOption) {
            logMessage(`AI (${player.name}): Strategy Exchange - Intended "4 auf die Sau" & option valid. Choosing SAU.`);
            return { type: EXCHANGE_TYPE.SAU, cardsToDiscard: [] };
        }
    }
    if (player.aiPlan && player.aiPlan.intendPackerlIfLastJoin) {
        if (numTrumps === 0 && validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.NORMAL_PACKERL)) {
            logMessage(`AI (${player.name}): Strategy Exchange - Intended Packerl (last join), no trumps. Choosing NORMAL_PACKERL.`);
            return { type: EXCHANGE_TYPE.NORMAL_PACKERL, cardsToDiscard: [] };
        }
        const isLowSingleTrump = numTrumps === 1 && !hasWeli && trumpCards[0] &&
            RANKS.indexOf(trumpCards[0].rank) <= RANKS.indexOf(config.exchange.maxTrumpValueForTrumpfPackerl);
        if (isLowSingleTrump && validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.TRUMPF_PACKERL)) {
            logMessage(`AI (${player.name}): Strategy Exchange - Intended Packerl (last join), low single trump. Choosing TRUMPF_PACKERL.`);
            return { type: EXCHANGE_TYPE.TRUMPF_PACKERL, cardsToDiscard: [] };
        }
    }

    if (!hasWeli && numTrumps === 1 && trumpCards[0] &&
        RANKS.indexOf(trumpCards[0].rank) <= RANKS.indexOf(config.exchange.maxTrumpValueForTrumpfPackerl) &&
        validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.TRUMPF_PACKERL)) {
        logMessage(`AI (${player.name}): Strategy Exchange - No Weli, single low trump. Choosing TRUMPF_PACKERL.`);
        return { type: EXCHANGE_TYPE.TRUMPF_PACKERL, cardsToDiscard: [] };
    }
    else if (numTrumps === 0 && !hasWeli &&
             validExchangeOptions.some(opt => opt.type === EXCHANGE_TYPE.NORMAL_PACKERL)) {
        logMessage(`AI (${player.name}): Strategy Exchange - No Trumps or Weli. Choosing NORMAL_PACKERL.`);
        return { type: EXCHANGE_TYPE.NORMAL_PACKERL, cardsToDiscard: [] };
    }

    const standardOption = validExchangeOptions.find(opt => opt.type === EXCHANGE_TYPE.STANDARD);
    if (standardOption) {
        let cardsToKeep = [];
        let nonTrumpAcesInHand = [];
        player.hand.forEach(card => {
            if ((trumpSuit && card.suit === trumpSuit) || card.rank === WELI_RANK || card.rank === 'A') {
                cardsToKeep.push(card);
                if (card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK) {
                    nonTrumpAcesInHand.push(card);
                }
            }
        });
        let acesToPotentiallyDiscard = [];
        if (nonTrumpAcesInHand.length > 1) {
            const sortedNonTrumpAces = _sortCardsByValue(nonTrumpAcesInHand, null, false);
            acesToPotentiallyDiscard = sortedNonTrumpAces.slice(1); // Keep highest, discard others
            // Refine cardsToKeep to only include the one best non-trump ace
            cardsToKeep = cardsToKeep.filter(c => !acesToPotentiallyDiscard.some(ad => ad.key === c.key));
        }
        let cardsToDiscardForStandard = player.hand.filter(card => !cardsToKeep.some(k => k.key === card.key));
        
        const maxDiscardCount = Math.min(standardOption.maxCards || 4, player.hand.length > 0 ? player.hand.length -1 : 0);
        if(cardsToDiscardForStandard.length > maxDiscardCount) {
             cardsToDiscardForStandard = _sortCardsByValue(cardsToDiscardForStandard, trumpSuit, true).slice(0, maxDiscardCount);
        }
        logMessage(`AI (${player.name}): Strategy Exchange - Standard. Discarding non-Trump/Weli/Ace (keeping best non-Trump Ace if multiple). Discarding ${cardsToDiscardForStandard.length} cards.`);
        return { type: EXCHANGE_TYPE.STANDARD, cardsToDiscard: cardsToDiscardForStandard };
    }

    logMessage(`AI (${player.name}): Strategy Exchange - Fallback Standard, discarding 0.`);
    return { type: EXCHANGE_TYPE.STANDARD, cardsToDiscard: [] };
}

// --- Play Lead Decision Function ---
export function decidePlayLead(player, validPlays, gameState, config) {
    const trumpSuit = gameState.trumpSuit;

    // --- USE player.hasSauWeli FLAG ---
    if (player.hasSauWeli) {
        if (gameState.tricksPlayedCount === 0) {
            const trumpAceCard = player.hand.find(c => c && c.rank === 'A' && c.suit === trumpSuit);
            if (trumpAceCard && validPlays.some(vp => vp && vp.key === trumpAceCard.key)) {
                logMessage(`AI (${player.name}): Strategy PlayLead - Has Sau+Weli flag, 1st trick. Playing Trump Ace.`);
                return trumpAceCard;
            } else {
                logMessage(`AI (${player.name}): Strategy PlayLead - Has Sau+Weli flag, wanted Ace on trick 0, but not found/valid. Falling back.`);
            }
        } else if (gameState.tricksPlayedCount === 1) {
            const weliCard = player.hand.find(c => c && c.rank === WELI_RANK);
            if (weliCard && validPlays.some(vp => vp && vp.key === weliCard.key)) {
                logMessage(`AI (${player.name}): Strategy PlayLead - Has Sau+Weli flag, 2nd trick. Playing Weli.`);
                return weliCard;
            } else {
                logMessage(`AI (${player.name}): Strategy PlayLead - Has Sau+Weli flag, wanted Weli on trick 1, but not found/valid. Falling back.`);
            }
        }
        // If hasSauWeli is true, but it's not trick 0 or 1, or the specific card wasn't valid, fall through to NEW fallback logic.
         logMessage(`AI (${player.name}): Strategy PlayLead - Has Sau+Weli flag, but not trick 0/1 or specific card invalid. Using new fallback lead logic.`);
    }
    // --- END Sau+Weli Logic ---


    // --- NEW FALLBACK LOGIC for Leading a Trick ---
    logMessage(`AI (${player.name}): Strategy PlayLead - Applying fallback lead logic.`);

    if (!validPlays || validPlays.length === 0) {
        logMessage(`AI CRITICAL (${player.name}): Strategy PlayLead - No valid plays array or it's empty in fallback. Returning null.`);
        return null;
    }

    // 1. Try to play the highest non-trump, non-Weli card.
    const nonTrumpNonWeliPlays = validPlays.filter(card => {
        if (!card) return false;
        const isTrump = (trumpSuit && card.suit === trumpSuit);
        const isWeli = (card.rank === WELI_RANK);
        return !isTrump && !isWeli;
    });

    if (nonTrumpNonWeliPlays.length > 0) {
        // Sort descending by card value (getCardValue handles trumpSuit correctly, but here they are non-trump)
        const sortedNonTrumpNonWeli = _sortCardsByValue(nonTrumpNonWeliPlays, null, false); // false for descending, null for trumpSuit as they are non-trump
        if (sortedNonTrumpNonWeli.length > 0 && sortedNonTrumpNonWeli[0]) {
            logMessage(`AI (${player.name}): Strategy PlayLead Fallback - Playing highest non-trump, non-Weli: ${sortedNonTrumpNonWeli[0].toString()}.`);
            return sortedNonTrumpNonWeli[0];
        }
    }

    // 2. If only trumps (and/or Weli) are left in validPlays:
    //    (This condition is met if nonTrumpNonWeliPlays.length was 0, and validPlays is not empty)
    logMessage(`AI (${player.name}): Strategy PlayLead Fallback - Only trumps/Weli seem to be valid plays.`);

    if (!player.hasSauWeli) {
        // If player does NOT have SauWeli combo, play the LOWEST trump.
        const sortedTrumpsAsc = _sortCardsByValue(validPlays, trumpSuit, true); // true for ascending
        if (sortedTrumpsAsc.length > 0 && sortedTrumpsAsc[0]) {
            logMessage(`AI (${player.name}): Strategy PlayLead Fallback - Only trumps left, NO SauWeli flag. Playing LOWEST trump: ${sortedTrumpsAsc[0].toString()}.`);
            return sortedTrumpsAsc[0];
        }
    } else {
        // Player HAS SauWeli flag, but the Ace/Weli specific play didn't trigger (e.g., wrong trick number, or Ace/Weli already played/invalid).
        // In this case, and only trumps are left, also play the lowest available trump.
        // This prevents getting stuck if, for example, Weli was already played for some reason and it's trick 1.
        const sortedTrumpsAsc = _sortCardsByValue(validPlays, trumpSuit, true);
        if (sortedTrumpsAsc.length > 0 && sortedTrumpsAsc[0]) {
            logMessage(`AI (${player.name}): Strategy PlayLead Fallback - Only trumps left, HAS SauWeli flag (but specific play not applicable). Playing LOWEST trump: ${sortedTrumpsAsc[0].toString()}.`);
            return sortedTrumpsAsc[0];
        }
    }

    // 3. Absolute last resort fallback (should ideally not be reached if validPlays has items)
    // This could happen if sorting somehow fails or if logic above has an issue.
    logMessage(`AI WARNING (${player.name}): Strategy PlayLead Fallback - Reached absolute last resort. Playing first valid play: ${validPlays[0]?.toString()}`);
    return validPlays[0] || null;
}

// js/aiStrategies.js (inside the decidePlayFollow function)

export function decidePlayFollow(player, validPlays, gameState, config) {
    const trumpSuit = gameState.trumpSuit;

    // --- Your specific rule block (assuming it's re-enabled or was not the primary issue) ---
    const leadCardPlay = gameState.currentTrick.length > 0 ? gameState.currentTrick[0] : null;
    const leadCard = leadCardPlay ? leadCardPlay.card : null;

    if (leadCard) { // Only apply specific rule if following
        const highestCardInTrickSoFar = GameRules.determineTrickWinner(gameState.currentTrick, trumpSuit) ?
                                        gameState.currentTrick.find(p => p.player === GameRules.determineTrickWinner(gameState.currentTrick, trumpSuit)).card :
                                        leadCard;
        const highestValueInTrick = getCardValue(highestCardInTrickSoFar, trumpSuit);

        const allValidAreTrumpsAndHead = validPlays && validPlays.length >= 2 && validPlays.every(vp => {
            if (!vp) return false; // Guard against undefined items in validPlays
            const vpIsTrump = ((trumpSuit && vp.suit === trumpSuit) || vp.rank === WELI_RANK);
            const vpValue = getCardValue(vp, trumpSuit);
            return vpIsTrump && vpValue > highestValueInTrick;
        });

        if (allValidAreTrumpsAndHead) {
            let sortedValidTrumps = _sortCardsByValue(validPlays, trumpSuit, true); // Should use the robust _sortCardsByValue
            if (sortedValidTrumps && sortedValidTrumps.length > 0 && sortedValidTrumps[0]) {
                logMessage(`AI (${player.name}): Strategy PlayFollow - Specific Rule: Must play Trump and head. Multiple options, playing lowest: ${sortedValidTrumps[0].toString()}.`);
                return sortedValidTrumps[0];
            } else {
                logMessage(`AI WARNING (${player.name}): Strategy PlayFollow - Specific Rule: Condition met but sorting failed or yielded no card. Falling through.`);
            }
        }
    }
    // --- End of specific rule block ---


    // --- Default/Fallback logic ---
    logMessage(`AI (${player.name}): Strategy PlayFollow - Entering default logic. validPlays count: ${validPlays ? validPlays.length : 'null'}.`);
    if (validPlays && validPlays.length > 0) {
        // Log the state of validPlays *before* sorting if it's small enough or problematic
        if (validPlays.length < 5 || validPlays.some(c => !c)) { // Log if few items or any are null/undefined
             logMessage(`AI DEBUG (${player.name}): PlayFollow default - validPlays before sort: ${JSON.stringify(validPlays.map(c => c ? c.key : null))}`);
        }

        let sortedPlays = _sortCardsByValue(validPlays, trumpSuit, true); // Uses the robust _sortCardsByValue

        if (sortedPlays && sortedPlays.length > 0 && sortedPlays[0]) {
            // This check ensures sortedPlays[0] is a valid card object
            logMessage(`AI (${player.name}): Strategy PlayFollow - Default, playing lowest value valid card: ${sortedPlays[0].toString()}.`);
            return sortedPlays[0];
        } else {
            logMessage(`AI ERROR (${player.name}): Strategy PlayFollow - Default logic: _sortCardsByValue returned empty or invalid array, even though validPlays had ${validPlays.length} items. sortedPlays: ${JSON.stringify(sortedPlays)}.`);
            // As an ABSOLUTE last resort, if GameRules.getValidPlays gave *something* valid but sorting somehow lost it:
            // Try to find the first truly valid card from the original validPlays
            const firstTrulyValidOriginalCard = validPlays.find(c => c && typeof c.toString === 'function');
            if (firstTrulyValidOriginalCard) {
                 logMessage(`AI (${player.name}): Strategy PlayFollow - ABSOLUTE FALLBACK - playing first truly valid from original validPlays: ${firstTrulyValidOriginalCard.toString()}`);
                 return firstTrulyValidOriginalCard;
            }
            logMessage(`AI CRITICAL (${player.name}): Strategy PlayFollow - No valid card could be determined even with fallbacks.`);
            return null; // Indicates a severe problem upstream (likely GameRules.getValidPlays)
        }
    }

    logMessage(`AI (${player.name}): Strategy PlayFollow - No valid plays array or it's empty. Returning null.`);
    return null; // Should be handled by aiPlayer.js if strategy returns null
}

// --- Generic Discard Decision Function ---
export function decideGenericDiscard(player, cardsToDiscardFrom, countToDiscard, reason, trumpSuit, gameState, config) {
    let handToConsider = [...cardsToDiscardFrom];
    let discards = [];

    let cardsToKeepInitially = handToConsider.filter(card =>
        (trumpSuit && card.suit === trumpSuit && card.rank !== WELI_RANK) ||
        card.rank === WELI_RANK ||
        card.rank === 'A'
    );
    let nonTrumpAces = cardsToKeepInitially.filter(card =>
        card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK
    );
    if (nonTrumpAces.length > 1) {
        const sortedNonTrumpAces = _sortCardsByValue(nonTrumpAces, null, false);
        const aceToKeep = sortedNonTrumpAces[0];
        cardsToKeepInitially = cardsToKeepInitially.filter(card =>
            !(card.rank === 'A' && (!trumpSuit || card.suit !== trumpSuit) && card.rank !== WELI_RANK && card.key !== aceToKeep.key)
        );
    }
    let potentialDiscards = handToConsider.filter(card => !cardsToKeepInitially.some(keep => keep.key === card.key));
    potentialDiscards = _sortCardsByValue(potentialDiscards, trumpSuit, true);

    for (let i = 0; i < potentialDiscards.length && discards.length < countToDiscard; i++) {
        discards.push(potentialDiscards[i]);
    }
    if (discards.length < countToDiscard) {
        let remainingKeptSorted = _sortCardsByValue(cardsToKeepInitially, trumpSuit, true);
        for (let i = 0; i < remainingKeptSorted.length && discards.length < countToDiscard; i++) {
            if (!discards.some(d => d.key === remainingKeptSorted[i].key)) {
                discards.push(remainingKeptSorted[i]);
            }
        }
    }
    const finalDiscards = discards.slice(0, countToDiscard);
    logMessage(`AI (${player.name}): Strategy Discard (${reason}) - Keeping Trumps/Weli/Best Ace. Discarding ${finalDiscards.length} cards: ${finalDiscards.map(c => c.toString()).join(', ')}.`);
    return finalDiscards;
}