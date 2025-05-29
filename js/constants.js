export const SUITS = ["Hearts", "Bells", "Leaves", "Acorns"];
export const RANKS = ["7", "8", "9", "X", "U", "O", "K", "A"]; // Use X for 10
export const WELI_RANK = "W"; // Special rank for Weli
export const WELI_SUIT = "Bells"; // Weli is traditionally Bells 6

// Card values for comparison (higher is better)
// Non-trump values based on index in RANKS
const BASE_RANK_VALUES = Object.fromEntries(RANKS.map((r, i) => [r, i]));

// Values adjusted for game context (trump, Weli)
// These need to be higher than base values
export const TRUMP_VALUE_OFFSET = 100; // Add this if a card is trump
const WELI_TRUMP_VALUE = TRUMP_VALUE_OFFSET + RANKS.length + 1; // Weli is 2nd highest trump
const ACE_TRUMP_VALUE = TRUMP_VALUE_OFFSET + RANKS.length + 2; // Ace is highest trump

export function getCardValue(card, trumpSuit) {
    if (!card) return -1;
    const isTrump = card.suit === trumpSuit;
    const isWeli = card.rank === WELI_RANK; // Weli is always Bells 6 conceptually

    if (isWeli) {
        // Weli acts as a trump, second only to Ace of actual trump suit
        return WELI_TRUMP_VALUE;
    }
    if (isTrump) {
        if (card.rank === "A") {
            return ACE_TRUMP_VALUE;
        }
        return TRUMP_VALUE_OFFSET + BASE_RANK_VALUES[card.rank];
    }
    // Non-trump card
    return BASE_RANK_VALUES[card.rank];
}


// Player Statuses
export const PLAYER_STATUS = {
    WAITING: 'waiting',
    ACTIVE_SNEAKER: 'Schlager',
    ACTIVE_PLAYER: 'Mitgeher',
    FOLDED: 'folded', // CHANGED FROM PASSED
    // Could add states like 'BID_ODER', 'BID_WEITER' if needed during bidding phase
};

// Game Phases (adjust as needed for sub-phases)
export const GAME_PHASE = {
    SETUP: 'setup',
    ANTE: 'ante',
    DEALING: 'dealing',
    DEALER_DISCARD: 'dealer_discard',
    BIDDING_STAGE_1: 'bidding_stage_1',
    BIDDING_STAGE_2: 'bidding_stage_2', // Join/Pass round
    RESOLVE_ODER: 'resolve_oder',
    EXCHANGE_PREP: 'exchange_prep', // Oder player discard
    EXCHANGE: 'exchange',
    FINAL_DISCARD: 'final_discard', // Discard down to 4
    PLAYING_TRICKS: 'playing_tricks',
    TRICK_END: 'trick_end',
    SCORING: 'scoring',
    ROUND_END: 'round_end',
    ALL_WEITER_PENALTY: 'all_weiter_penalty',
};

// Exchange Options
export const EXCHANGE_TYPE = {
    STANDARD: 'standard',
    SAU: '4_auf_die_Sau',
    TRUMPF_PACKERL: 'Trumpf_Packerl',
    NORMAL_PACKERL: 'Normales_Packerl',
};

// Bidding Options
export const BID_OPTIONS = {
    WEITER: 'Weiter',
    SNEAK: 'I schlogs!',
    ODER_MIT: 'Oder mit',
    ODER_OHNE: 'Oder ohne',
    PLAY: 'I geh mit',
    FOLD: 'Fold', // CHANGED FROM PASS
};

// --- Card Image Filename Mapping ---

const SUIT_TO_FILENAME = {
    "Hearts": "h",
    "Leaves": "p", // For Pik
    "Bells": "s",  // For Schellen
    "Acorns": "e" // For Eichel
};

const RANK_TO_FILENAME = {
    "7": "7",
    "8": "8",
    "9": "9",
    "X": "10", // Game uses 'X', filename uses '10'
    "U": "u",
    "O": "o",
    "K": "k",
    "A": "s"  // Game uses 'A' (Ace), filename uses 'S' (Sau)
};

export function getCardImageFilename(card) {
    // Handle potential null/undefined card object gracefully
    if (!card || !card.rank) {
        console.warn("getCardImageFilename called with invalid card:", card);
        return 'card_back.jpg'; // Provide a fallback image name
    }

    // Special case for Weli
    if (card.rank === WELI_RANK) { // WELI_RANK should be 'W'
        return 'weli.jpg';
    }

    // Standard cards
    const suitCode = SUIT_TO_FILENAME[card.suit];
    const rankCode = RANK_TO_FILENAME[card.rank];

    if (suitCode && rankCode) {
        return `${suitCode}${rankCode}.jpg`;
    } else {
        // Log an error if mapping fails for a valid card object
        console.error(`Could not generate filename for card: Rank='${card.rank}', Suit='${card.suit}'`);
        return 'card_back.jpg'; // Fallback image
    }
}