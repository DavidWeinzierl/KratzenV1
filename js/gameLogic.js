// js/gameLogic.js
import { SUITS, RANKS, WELI_RANK, WELI_SUIT, getCardValue, PLAYER_STATUS, GAME_PHASE, EXCHANGE_TYPE, BID_OPTIONS, TRUMP_VALUE_OFFSET } from './constants.js';

// --- Card Class ---
export class Card {
    constructor(suit, rank) {
        this.suit = suit;
        this.rank = rank; // e.g., "7", "K", "A", "W"
    }

    // Simple string representation
    toString() {
        return `${this.rank}${this.suit ? this.suit.charAt(0) : '?'}`; // e.g., KH, 7L, WB
    }

    // Unique key for comparisons or sets
    get key() {
        return `${this.rank}-${this.suit}`;
    }
}

// --- Deck Class ---
export class Deck {
    constructor() {
        this.cards = [];
        this.buildDeck();
        this.shuffle();
    }

    buildDeck() {
        this.cards = [];
        for (const suit of SUITS) {
            for (const rank of RANKS) {
                this.cards.push(new Card(suit, rank));
            }
        }
        // Add Weli
        this.cards.push(new Card(WELI_SUIT, WELI_RANK));
    }

    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
    }

    deal(count = 1) {
        if (count === 1) {
            return this.cards.pop();
        }
        // Ensure we don't try to splice more than available
        const numToDeal = Math.min(count, this.cards.length);
        if (numToDeal <= 0) return [];
        return this.cards.splice(-numToDeal); // Removes from end
    }


    isEmpty() {
        return this.cards.length === 0;
    }

    get remaining() {
        return this.cards.length;
    }
}

// --- Player Class ---
export class Player {
    constructor(id, name = `Player ${id + 1}`) {
        this.id = id;
        this.name = name;
        this.hand = []; // Array of Card objects
        this.points = 0; // Simulation points
        this.hasSauWeli = false;
        this.resetRound();
    }

    resetRound() {
        this.hand = [];
        this.status = PLAYER_STATUS.WAITING;
        this.role = null; // 'dealer', 'sneaker', 'player' (could combine with status)
        this.tricksWonThisRound = 0;
        this.hasBid = false; // Flag for bidding round/exchange/discard/play turn
        this.currentBid = null; // Store the bid ('Weiter', 'Sneak', 'Oder mit', etc.)
        this.exchangeAction = null; // Store chosen exchange action
        this.cardsToDiscard = []; // Store cards chosen for discard
        this.lastActionLog = ''; // Reset action log
        this.hasSauWeli = false; 
        this.aiPlan = {}; // reset AI strategy plan -> clear up space, especially for simulation
    }

    addCards(cards) {
        if (!Array.isArray(cards)) cards = [cards];
        // Filter out any non-Card objects before pushing
        this.hand.push(...cards.filter(c => c instanceof Card));
        // Optional: Sort hand for display/AI
        // this.hand.sort((a, b) => /* sorting logic */);
    }


    removeCard(cardToRemove) {
        // Ensure cardToRemove is valid before accessing key
        if (!cardToRemove || typeof cardToRemove.key === 'undefined') {
             console.warn("Attempted to remove invalid card:", cardToRemove);
             return null;
        }
        const index = this.hand.findIndex(card => card && card.key === cardToRemove.key);
        if (index > -1) {
            return this.hand.splice(index, 1)[0];
        }
        console.warn(`Card not found in hand for removal: ${cardToRemove.key} in P${this.id}`);
        return null; // Card not found
    }


    hasTrump(trumpSuit) {
         if (trumpSuit === null || trumpSuit === undefined) return false; // Cannot have trump if suit is unknown
        return this.hand.some(card => card && (card.suit === trumpSuit || card.rank === WELI_RANK));
    }

    getTrumpCards(trumpSuit) {
        if (trumpSuit === null || trumpSuit === undefined) return [];
        return this.hand.filter(card => card && (card.suit === trumpSuit || card.rank === WELI_RANK));
    }

    getNonTrumpCards(trumpSuit) {
        // If trumpSuit is null/undefined, all cards are non-trump (edge case for early logic)
        if (trumpSuit === null || trumpSuit === undefined) return [...this.hand];
        return this.hand.filter(card => card && (card.suit !== trumpSuit && card.rank !== WELI_RANK));
    }

    checkForSauWeli(trumpSuit) {
        if (!trumpSuit || !this.hand || this.hand.length === 0) {
            this.hasSauWeli = false;
            return false;
        }
        const hasTrumpAce = this.hand.some(card => card && card.rank === 'A' && card.suit === trumpSuit);
        const hasWeli = this.hand.some(card => card && card.rank === WELI_RANK);
        this.hasSauWeli = hasTrumpAce && hasWeli;
        return this.hasSauWeli;
    }
}

// --- GameState Class ---
// Holds the entire state of the game at any point
export class GameState {
    constructor(playerCount = 3, initialPoints = 0) {
        if (playerCount < 3 || playerCount > 5) throw new Error("Must have 3-5 players");
        this.players = Array.from({ length: playerCount }, (_, i) => new Player(i));
        this.dealerIndex = Math.floor(Math.random() * playerCount); // Initial dealer
        this.deck = new Deck();
        this.talon = []; // Cards remaining after deal
        this.discardPile = []; // General discard pile (bonfire)
        this.foldedPile = []; // Cards from players who folded
        this.phase = GAME_PHASE.SETUP;
        this.subPhase = null; // e.g., 'dealing_batch_1', 'player_0_bid'
        this.turnPlayerIndex = -1; // Index of player whose turn it is
        this.trumpCard = null; // The card turned up (or drawn for Oder)
        this.trumpSuit = null;
        this.originalTrumpCard = null; // Store the first card turned if Weli appears
        this.currentTrick = []; // Array of { player, card } objects
        this.trickLeadPlayerIndex = -1; // Player who led the current trick
        this.tricksPlayedCount = 0;
        this.activePlayerOrder = []; // Order of players still in the hand (determined after bidding)
        this.sneaker = null; // The Player object who is the sneaker
        this.oderPlayer = null; // Player who bid Oder first
        this.oderType = null; // 'mit' or 'ohne'
        this.roundWinner = null; // If Sneaker wins uncontested
        this.lastActionLog = ""; // Store description of the last general action
        this.isAutoSneaker = false; // Flag if Ace turned up
        this.needsDealerDiscard = 0; // 0, 1, or 2 cards dealer needs to discard
        this.needsOderDiscard = false; // If Oder player needs to discard 1
        this.needsFinalDiscardPlayers = []; // Players who need to discard down to 4

        this.isWaitingForBidInput = false; // Flag to pause controller for manual bid
        this.pendingValidBids = [];      // Store bids for UI buttons when paused
    }

    getPlayerById(id) {
        return this.players.find(p => p.id === id);
    }

    getActivePlayers() {
        // Returns players who are still competing for tricks
        return this.players.filter(p =>
            p.status === PLAYER_STATUS.ACTIVE_PLAYER || p.status === PLAYER_STATUS.ACTIVE_SNEAKER
        );
    }

     // Helper to get next player index in clockwise order
     nextPlayerIndex(currentIndex) {
        if (this.players.length === 0) return -1;
        return (currentIndex + 1) % this.players.length;
     }

     // Helper to get next *active* player index based on a pre-defined list
     nextActivePlayerIndex(currentActivePlayerId, activePlayersList) {
         if (!activePlayersList || activePlayersList.length === 0) return -1;
         const currentListIndex = activePlayersList.findIndex(p => p.id === currentActivePlayerId);
         if (currentListIndex === -1) {
              console.warn(`Player ID ${currentActivePlayerId} not found in provided active list.`);
              return -1; // Player not found in the list
         }
         // Return the ID of the next player in the list, wrapping around
         return activePlayersList[(currentListIndex + 1) % activePlayersList.length].id;
     }
}


// --- GameRules Module ---
// Contains pure functions to determine valid moves, outcomes, etc.
// Does NOT modify the gameState object directly.
export const GameRules = {

    getValidBids(gameState) {
        const currentPlayer = gameState.players[gameState.turnPlayerIndex];
        // Added status check for safety and hasBid check
        if (!currentPlayer || currentPlayer.status === PLAYER_STATUS.FOLDED || currentPlayer.hasBid) return [];

        let options = [];
        const phase = gameState.phase;

        if (phase === GAME_PHASE.BIDDING_STAGE_1) {
            // Ensure player hasn't already bid in this stage
             if (!currentPlayer.hasBid) {
                 options.push(BID_OPTIONS.WEITER);
                 options.push(BID_OPTIONS.SNEAK);
                 // Only allow Oder if NO Oder has been bid yet this round
                 if (!gameState.oderPlayer) {
                     options.push(BID_OPTIONS.ODER_MIT);
                     options.push(BID_OPTIONS.ODER_OHNE);
                 }
            }
        } else if (phase === GAME_PHASE.BIDDING_STAGE_2) {
             // Ensure player isn't the sneaker and hasn't already bid Play/Fold in this stage
             if (currentPlayer !== gameState.sneaker && !currentPlayer.hasBid) {
                 options.push(BID_OPTIONS.PLAY);
                 options.push(BID_OPTIONS.FOLD);
             }
        }
        return options;
    },

    getValidExchangeOptions(player, trumpSuit) {
        // Basic safety check for the player object and hand
        if (!player || !player.hand) {
            console.error("getValidExchangeOptions called with invalid player object.");
            return [{ type: EXCHANGE_TYPE.STANDARD, maxCards: 4 }]; // Default safe option
        }
        // Start with the default standard exchange option
        let options = [{ type: EXCHANGE_TYPE.STANDARD, maxCards: 4 }];

        // --- Logic for Special Exchanges (V10 Rules) ---
        // Only check if trumpSuit is valid (not null or undefined)
        if (trumpSuit !== null && trumpSuit !== undefined) {
            const trumpCardsInHand = player.hand.filter(card => card && (card.suit === trumpSuit || card.rank === WELI_RANK));
            const trumpCount = trumpCardsInHand.length;
            const hasAceTrump = trumpCardsInHand.some(card => card && card.rank === 'A' && card.suit === trumpSuit);

            // Check for SAU (4 auf die Sau): Exactly 1 trump, which is the Ace of trump.
            if (trumpCount === 1 && hasAceTrump) {
                options.push({ type: EXCHANGE_TYPE.SAU });
            }
            // Check for TRUMPF_PACKERL: Exactly 1 Trump (Ace, Weli, or other). Cannot be chosen if SAU is possible.
             if (trumpCount === 1) {
                 if (!options.some(opt => opt.type === EXCHANGE_TYPE.SAU)) {
                    options.push({ type: EXCHANGE_TYPE.TRUMPF_PACKERL });
                 }
             }
            // Check for NORMAL_PACKERL: Exactly 0 Trumps.
            if (trumpCount === 0) {
                options.push({ type: EXCHANGE_TYPE.NORMAL_PACKERL });
            }
        } else {
            console.warn("Cannot check special exchange options: trumpSuit is null or undefined.");
        }
        return options;
    }, // End getValidExchangeOptions

      // --- UPDATED getValidPlays (Fix for Weli/Trump lead Stichzwang) ---
      getValidPlays(gameState, player) {
        const hand = player.hand;
        if (!hand || hand.length === 0) return [];

        const trick = gameState.currentTrick;
        const isTrickLeader = !trick || trick.length === 0;
        const trumpSuit = gameState.trumpSuit;

        // Filter hand for valid cards at the start
        const validHand = hand.filter(c => c);
        if (validHand.length === 0) return []; // No valid cards

        if (isTrickLeader) {
            // Can lead any card
            return [...validHand];
        }

        // --- Following logic ---
        const leadPlay = trick[0]; // First play determines the lead
        const leadCard = leadPlay?.card;

        if (!leadCard) {
            console.error("Error in getValidPlays: Lead card is missing in non-empty trick.");
            return [...validHand]; // Failsafe
        }

        // Determine the actual suit led, treating Weli as trump if trump exists
        let ledSuit = leadCard.suit;
        const leadIsWeli = leadCard.rank === WELI_RANK;
        const leadIsTrump = trumpSuit && (leadCard.suit === trumpSuit || leadIsWeli);

        if (leadIsTrump && trumpSuit) {
            ledSuit = trumpSuit; // The "suit to follow" is trump
        }

        // Player's capabilities
        const myTrumps = trumpSuit ? validHand.filter(card => card.suit === trumpSuit || card.rank === WELI_RANK) : [];
        const canTrump = myTrumps.length > 0;
        // Cards in the strictly led suit (excluding Weli unless it IS the trump suit)
        const cardsInLedSuitStrict = validHand.filter(card => card.suit === ledSuit && card.rank !== WELI_RANK);
        // Can the player follow the specific suit led? (Handles non-trump leads)
        const canFollowNonTrumpSuit = !leadIsTrump && cardsInLedSuitStrict.length > 0;


        // --- Determine Highest Card/Value in Trick ---
        let highestValueInTrick = -1;
        let highestCardInTrick = null; // Track the actual card object
        let trickIsTrumped = false; // Has a trump been played AFTER the lead?

        for (const play of trick) {
            if (!play || !play.card) continue;
            const playValue = getCardValue(play.card, trumpSuit);
            const playIsTrump = trumpSuit && (play.card.suit === trumpSuit || play.card.rank === WELI_RANK);

            if (playIsTrump) {
                trickIsTrumped = true; // Mark that a trump is present
            }

            // Update highest value if current card is trump and highest wasn't, OR if it's a higher value of the relevant suit
            if ( (playIsTrump && (!highestCardInTrick || !getCardValue(highestCardInTrick, trumpSuit) || getCardValue(highestCardInTrick, trumpSuit) < TRUMP_VALUE_OFFSET)) || // Current is trump, highest wasn't (or invalid)
                 (playIsTrump && getCardValue(highestCardInTrick, trumpSuit) >= TRUMP_VALUE_OFFSET && playValue > highestValueInTrick) || // Both trump, current is higher
                 (!playIsTrump && (!highestCardInTrick || getCardValue(highestCardInTrick, trumpSuit) < TRUMP_VALUE_OFFSET) && play.card.suit === ledSuit && playValue > highestValueInTrick) // Neither trump, both followed suit, current is higher
               )
            {
                 highestValueInTrick = playValue;
                 highestCardInTrick = play.card;
            }
        }
        // Ensure highestValueInTrick reflects the potentially updated highestCardInTrick
        if (highestCardInTrick) {
             highestValueInTrick = getCardValue(highestCardInTrick, trumpSuit);
        }


        // --- Determine Playable Cards ---
        let playableCards = [];

        // Case 1: Trump was led (or Weli led when trump exists)
        if (leadIsTrump) {
            if (canTrump) {
                // Must play trump
                playableCards = myTrumps;
                // Apply Trump Stichzwang: Must play higher than highest card in trick if possible
                const higherTrumps = playableCards.filter(card => getCardValue(card, trumpSuit) > highestValueInTrick);
                if (higherTrumps.length > 0) {
                    // console.log(`Debug: Must head trump lead. Highest value: ${highestValueInTrick}. Higher options: ${higherTrumps.map(c=>c.toString())}`);
                    playableCards = higherTrumps;
                } else {
                     // Cannot head, can play any trump
                    // console.log(`Debug: Cannot head trump lead. Highest value: ${highestValueInTrick}. Playing any trump.`);
                }
            } else {
                // Cannot trump when trump was led -> play anything
                 // console.log(`Debug: Cannot follow trump lead, playing anything.`);
                playableCards = [...validHand];
            }
        }
        // Case 2: Non-trump was led, and player can follow that suit
        else if (canFollowNonTrumpSuit) {
            playableCards = cardsInLedSuitStrict;
            // Apply Suit Stichzwang: Must head only if trick hasn't been trumped yet
            if (!trickIsTrumped) {
                const higherInSuit = playableCards.filter(card => getCardValue(card, trumpSuit) > highestValueInTrick);
                if (higherInSuit.length > 0) {
                    // console.log(`Debug: Must head non-trump suit. Highest value: ${highestValueInTrick}. Higher options: ${higherInSuit.map(c=>c.toString())}`);
                    playableCards = higherInSuit;
                } else {
                     // Cannot head in suit, can play any card of the suit
                     // console.log(`Debug: Cannot head non-trump suit. Highest value: ${highestValueInTrick}. Playing any of suit.`);
                }
            } else {
                 // Trick is already trumped, no need to head the non-trump suit
                 // console.log(`Debug: Following non-trump suit, but trick already trumped. No need to head.`);
            }
            // Optional Weli play: Can also play Weli if held (unless forced to head with suit card)
             if (trumpSuit && hand.some(c => c.rank === WELI_RANK)) {
                 const weliCard = hand.find(c => c.rank === WELI_RANK);
                 // Only add Weli if it's not already the only valid play
                 if (weliCard && !playableCards.some(pc => pc.key === weliCard.key)) {
                      // Check if we *must* play a specific suit card - if so, don't add Weli
                      const mustPlaySpecificSuitCard = playableCards.length === 1 && playableCards[0].suit === ledSuit;
                      if(!mustPlaySpecificSuitCard) {
                           playableCards.push(weliCard);
                            // console.log(`Debug: Added optional Weli play.`);
                      }
                 }
             }
        }
        // Case 3: Non-trump was led, cannot follow suit, but can trump
        else if (canTrump) {
            playableCards = myTrumps;
            // Apply Trump Stichzwang: Must play higher than the current highest *trump* in the trick, if any trump exists
            const highestTrumpValueInTrick = trick
                .filter(p => p.card && trumpSuit && (p.card.suit === trumpSuit || p.card.rank === WELI_RANK))
                .reduce((maxVal, p) => Math.max(maxVal, getCardValue(p.card, trumpSuit)), -1);

            if (highestTrumpValueInTrick > -1) { // Only apply if a trump is already there
                const higherTrumps = playableCards.filter(card => getCardValue(card, trumpSuit) > highestTrumpValueInTrick);
                if (higherTrumps.length > 0) {
                    // console.log(`Debug: Must head existing trump. Highest trump value: ${highestTrumpValueInTrick}. Higher options: ${higherTrumps.map(c=>c.toString())}`);
                    playableCards = higherTrumps;
                } else {
                    // Cannot head existing trump, can play any trump
                     // console.log(`Debug: Cannot head existing trump. Highest trump value: ${highestTrumpValueInTrick}. Playing any trump.`);
                }
            } else {
                 // No trump in trick yet, any trump is valid to play
                 // console.log(`Debug: Trumping non-trump lead. No existing trump. Playing any trump.`);
            }
        }
        // Case 4: Cannot follow suit, cannot trump
        else {
            playableCards = [...validHand]; // Play anything
             // console.log(`Debug: Cannot follow or trump. Playing anything.`);
        }

        // Final cleanup: ensure unique cards and filter nulls/undefined
        const uniquePlayable = [...new Map(playableCards.filter(c => c).map(item => [item.key, item])).values()];
        if(uniquePlayable.length === 0 && validHand.length > 0) {
             console.error(`CRITICAL Error in getValidPlays: No valid plays determined, but player has cards! Hand: ${validHand.map(c=>c.toString())}, Trick: ${trick.map(p=>p?.card?.toString())}`);
             return [...validHand]; // Failsafe: return all cards if logic failed
        }
        // console.log(`Final Valid Plays for ${player.name}: ${uniquePlayable.map(c=>c.toString())}`);
        return uniquePlayable;
    }, // End getValidPlays


    determineTrickWinner(trick, trumpSuit) {
        if (!trick || trick.length === 0) return null;

        let winningPlay = trick.find(p => p && p.card); // Find first valid play as initial winner
        if (!winningPlay) return null; // No valid cards in trick

        let highestValue = getCardValue(winningPlay.card, trumpSuit);
        // Determine lead suit, considering Weli as trump if trumpSuit is defined
        let leadSuit = (winningPlay.card.rank === WELI_RANK && trumpSuit) ? trumpSuit : winningPlay.card.suit;

        for (let i = 1; i < trick.length; i++) {
            const currentPlay = trick[i];
            if (!currentPlay || !currentPlay.card) continue; // Skip invalid plays

            const currentValue = getCardValue(currentPlay.card, trumpSuit);
            const currentIsTrump = trumpSuit && (currentPlay.card.suit === trumpSuit || currentPlay.card.rank === WELI_RANK);
            const winningIsTrump = trumpSuit && (winningPlay.card.suit === trumpSuit || winningPlay.card.rank === WELI_RANK);

            // --- Winning Logic ---
            // 1. Current is Trump, Winner is Not -> Current wins
            if (currentIsTrump && !winningIsTrump) {
                winningPlay = currentPlay;
                highestValue = currentValue;
            }
            // 2. Both are Trump -> Higher value wins
            else if (currentIsTrump && winningIsTrump) {
                if (currentValue > highestValue) {
                    winningPlay = currentPlay;
                    highestValue = currentValue;
                }
            }
            // 3. Neither is Trump -> Check if current followed lead suit and winner didn't OR if current followed and is higher value
            else if (!currentIsTrump && !winningIsTrump) {
                 if (currentPlay.card.suit === leadSuit && winningPlay.card.suit !== leadSuit) {
                     // Current followed suit, winner didn't -> Current wins
                     winningPlay = currentPlay;
                     highestValue = currentValue;
                 } else if (currentPlay.card.suit === leadSuit && winningPlay.card.suit === leadSuit) {
                     // Both followed suit -> Higher value wins
                     if (currentValue > highestValue) {
                        winningPlay = currentPlay;
                        highestValue = currentValue;
                     }
                 }
                 // Otherwise (e.g., current didn't follow suit), the current winner remains winner
            }
             // 4. Winner is Trump, Current is Not -> Winner remains winner (no action needed)
        }
        return winningPlay.player; // Return the winning Player object
    }, // End determineTrickWinner


    // --- calculateRoundScores (MODIFIED Muas Penalty Application) ---
    calculateRoundScores(gameState, dealerAnte, muasPenalty) {
        const scores = {};
        const roundWinner = gameState.roundWinner; // Uncontested winner, if any
        const sneaker = gameState.sneaker;
        const baseSneakerFailPenalty = 8; // V2 Rules: Fixed base penalty for 0/1 trick
        const basePlayerFailPenalty = 4;  // V2 Rules: Fixed base penalty for 0 tricks

        let applyNoLosersPenalty = (sneaker !== null); // Penalty *potentially* applies if a sneaker existed during the round
        let activePlayerCount = 0; // Count players who didn't fold

        // --- First Loop: Calculate Base Scores & Check for Individual Failures ---
        for (const player of gameState.players) {
            let baseScore = 0;
            let reportedTricks = 0;
            const isDealer = gameState.dealerIndex === player.id;
            const currentStatus = player.status || PLAYER_STATUS.WAITING; // Use status at end of round

            // Determine Base Score based on status and tricks
            if (roundWinner && player === roundWinner) {
                reportedTricks = 4;
                baseScore = reportedTricks;
                activePlayerCount++;
                // No failure occurred
            } else if (currentStatus === PLAYER_STATUS.FOLDED) {
                baseScore = 0;
                reportedTricks = 0;
                // Folded players don't count as active but WILL receive penalty if applied
            } else if (currentStatus === PLAYER_STATUS.ACTIVE_SNEAKER) {
                activePlayerCount++;
                const tricks = player.tricksWonThisRound;
                reportedTricks = tricks;
                if (tricks >= 2) { // Sneaker success
                    baseScore = tricks;
                } else { // Sneaker failure
                    baseScore = tricks - baseSneakerFailPenalty;
                    applyNoLosersPenalty = false; // A failure occurred
                }
            } else if (currentStatus === PLAYER_STATUS.ACTIVE_PLAYER) {
                activePlayerCount++;
                 const tricks = player.tricksWonThisRound;
                 reportedTricks = tricks;
                 if (tricks >= 1) { // Player success
                     baseScore = tricks;
                 } else { // Player failure
                     baseScore = tricks - basePlayerFailPenalty;
                     applyNoLosersPenalty = false; // A failure occurred
                 }
            } else {
                 console.warn(`Calculating score for player ${player.name} with unexpected status: ${currentStatus}. Setting base score to 0.`);
                 baseScore = 0;
                 reportedTricks = 0;
            }

            // Calculate intermediate score (before Muas penalty)
            let finalScore = baseScore;
            if (isDealer) {
                finalScore -= dealerAnte;
            }

            // Store intermediate results (status no longer needed for penalty check)
            scores[player.id] = {
                points: finalScore,
                tricks: reportedTricks,
                // _status: currentStatus // No longer need to store status for penalty logic
            };
        } // --- End of First Loop ---


        // --- Apply "Muas" (No Losers) Penalty if applicable ---
        // Condition: Penalty was not cancelled AND there was a sneaker AND AT LEAST ONE active player existed
        if (applyNoLosersPenalty && sneaker && activePlayerCount >= 1) {
            const penaltyAmount = muasPenalty; // Use the configurable penalty value
            console.log(`Applying 'Muas' (No Loser) penalty (-${penaltyAmount.toFixed(1)}) to ALL players.`); // Changed log message

            // **** THIS IS THE CORRECTED LOOP ****
            for (const playerIdStr in scores) {
                // Apply penalty to EVERY player (active or folded)
                scores[playerIdStr].points -= penaltyAmount;
            }
        }

        // // Clean up temporary status (No longer needed)
        // for (const playerIdStr in scores) {
        //      delete scores[playerIdStr]._status;
        // }

        return scores;
    }, // End calculateRoundScores

     // --- calculateAllWeiterScores (Uses dealerAnte) ---
     calculateAllWeiterScores(gameState, dealerAnte) {
        const scores = {};
         for (const player of gameState.players) {
             const isDealer = gameState.dealerIndex === player.id;
             let finalScore = -1; // Base penalty for All Weiter is fixed at -1

             if (isDealer) {
                  // Use the dealerAnte parameter passed into the function
                 finalScore -= dealerAnte;
             }
             scores[player.id] = { points: finalScore, tricks: 0 };
         }
         return scores;
     } // End calculateAllWeiterScores

}; // End GameRules