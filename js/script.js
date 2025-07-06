import {
    initializeGame,
    nextStep,
    setDealerAnte,
    setMuasPenalty,
    updateStrategyParameter,
    setAnimationSpeed, // This function still expects seconds
    runBatchSimulation,
    toggleOtherPlayersCardVisibility
} from './controller.js';

import { RANKS, SUITS, WELI_RANK, WELI_SUIT, getCardImageFilename } from './constants.js';
import { logMessage } from './logger.js';

// --- NEW: Preload all card images for smoother animations ---
async function preloadCardImages() {
    logMessage("Preloading card images...");
    const allCardsToLoad = [];

    // Add all standard suit cards
    for (const suit of SUITS) {
        for (const rank of RANKS) {
            allCardsToLoad.push({ suit, rank });
        }
    }
    // Add the Weli
    allCardsToLoad.push({ suit: WELI_SUIT, rank: WELI_RANK });
    // Add the card back
    allCardsToLoad.push(null);

    const imagePromises = allCardsToLoad.map(card => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const filename = getCardImageFilename(card);
            img.src = `img/${filename}`;
            img.onload = () => resolve(filename);
            img.onerror = () => reject(filename);
        });
    });

    try {
        await Promise.all(imagePromises);
        logMessage("All card images preloaded successfully.");
    } catch (failedFilename) {
        logMessage(`Error: Failed to preload image: ${failedFilename}`);
        console.error(`Failed to preload image: img/${failedFilename}`);
    }
}


// --- Helper function to map virtual speed to seconds ---
function mapVirtualSpeedToSeconds(virtualSpeed) {
    // virtualSpeed is 1 to 10
    // We want 1 -> 0.5s (slowest), 10 -> 0.1s (fastest)
    // This is a linear interpolation.
    // y = y_max - ( (x - x_min) * (y_max - y_min) ) / (x_max - x_min)
    // x = virtualSpeed
    // x_min = 1, y_max_seconds = 0.5 (seconds for slowest speed)
    // x_max = 10, y_min_seconds = 0.1 (seconds for fastest speed)

    const minVirtualSpeed = 1;
    const maxVirtualSpeed = 10;
    const maxSeconds = 0.5; // Corresponds to minVirtualSpeed
    const minSeconds = 0.1; // Corresponds to maxVirtualSpeed

    // Ensure virtualSpeed is within bounds for calculation, though slider should enforce this
    const clampedVirtualSpeed = Math.max(minVirtualSpeed, Math.min(maxVirtualSpeed, virtualSpeed));

    if (maxVirtualSpeed === minVirtualSpeed) return maxSeconds; // Avoid division by zero if range is 1

    const seconds = maxSeconds - ( (clampedVirtualSpeed - minVirtualSpeed) * (maxSeconds - minSeconds) ) / (maxVirtualSpeed - minVirtualSpeed);
    return parseFloat(seconds.toFixed(2)); // Return as number with 2 decimal places
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Loaded. Initializing Simulation.");

        // --- NEW: Call the preload function ---
        await preloadCardImages();

    const animationSpeedSlider = document.getElementById('animation-speed-slider');
    const animationSpeedValueSpan = document.getElementById('animation-speed-value');
    const dealerAnteSlider = document.getElementById('dealer-ante-slider');
    const dealerAnteValueSpan = document.getElementById('dealer-ante-value');
    const muasPenaltySlider = document.getElementById('no-loser-penalty-slider');
    const muasPenaltyValueSpan = document.getElementById('no-loser-penalty-value');
    const hideCardsToggleButton = document.getElementById('hide-cards-toggle');

    function setupStrategyControl(inputId, valueDisplayId, targetGroup, category, parameterName, isCheckbox = false, isFloat = false, isSelect = false) {
        const inputElement = document.getElementById(inputId);
        const valueDisplayElement = valueDisplayId ? document.getElementById(valueDisplayId) : null;
        if (!inputElement) { console.warn(`Strategy control element not found: #${inputId}`); return; }
        
        let initialValue;
        if (isCheckbox) {
            initialValue = inputElement.checked;
        } else if (isSelect) {
            initialValue = inputElement.value;
        } else if (isFloat) {
            initialValue = parseFloat(inputElement.value);
        } else {
            initialValue = parseInt(inputElement.value, 10); // Default to int for range sliders not marked float
        }

        if (valueDisplayElement && !isCheckbox && !isSelect) {
            valueDisplayElement.textContent = isFloat ? initialValue.toFixed(2) : initialValue.toString();
        }
        updateStrategyParameter(targetGroup, category, parameterName, initialValue);
        
        const eventType = isCheckbox || isSelect ? 'change' : 'input';
        inputElement.addEventListener(eventType, () => {
            let currentValue;
            if (isCheckbox) {
                currentValue = inputElement.checked;
            } else if (isSelect) {
                currentValue = inputElement.value;
            } else if (isFloat) {
                currentValue = parseFloat(inputElement.value);
            } else {
                currentValue = parseInt(inputElement.value, 10);
            }

            if (valueDisplayElement && !isCheckbox && !isSelect) {
                valueDisplayElement.textContent = isFloat ? currentValue.toFixed(2) : currentValue.toString();
            }
            updateStrategyParameter(targetGroup, category, parameterName, currentValue);
        });
    }

    if (hideCardsToggleButton) {
        hideCardsToggleButton.addEventListener('click', () => {
            toggleOtherPlayersCardVisibility();
        });
    } else {
        console.warn("Hide Cards Toggle button not found!");
    }

    if (animationSpeedSlider && animationSpeedValueSpan) {
        const initialVirtualSpeed = parseInt(animationSpeedSlider.value, 10);
        animationSpeedValueSpan.textContent = initialVirtualSpeed.toString(); // Display virtual speed (1-10)
        const initialSeconds = mapVirtualSpeedToSeconds(initialVirtualSpeed);
        setAnimationSpeed(initialSeconds); 

        animationSpeedSlider.addEventListener('input', () => {
            const virtualSpeed = parseInt(animationSpeedSlider.value, 10);
            animationSpeedValueSpan.textContent = virtualSpeed.toString(); // Display virtual speed (1-10)
            const seconds = mapVirtualSpeedToSeconds(virtualSpeed);
            setAnimationSpeed(seconds);
        });
    } else {
        console.warn("Animation speed slider or value display not found!");
    }

    if (dealerAnteSlider && dealerAnteValueSpan) {
        const initialAnte = parseFloat(dealerAnteSlider.value);
        dealerAnteValueSpan.textContent = initialAnte.toFixed(1);
        setDealerAnte(initialAnte);
        dealerAnteSlider.addEventListener('input', () => {
            const value = parseFloat(dealerAnteSlider.value);
            dealerAnteValueSpan.textContent = value.toFixed(1);
            setDealerAnte(value);
        });
    } else {
        console.warn("Dealer Ante slider or value display not found!");
    }

    if (muasPenaltySlider && muasPenaltyValueSpan) {
        const initialPenalty = parseFloat(muasPenaltySlider.value);
        muasPenaltyValueSpan.textContent = initialPenalty.toFixed(1);
        setMuasPenalty(initialPenalty);
        muasPenaltySlider.addEventListener('input', () => {
            const value = parseFloat(muasPenaltySlider.value);
            muasPenaltyValueSpan.textContent = value.toFixed(1);
            setMuasPenalty(value);
        });
    } else {
        console.warn('"Muas" Penalty slider or value display not found!');
    }

    // P0 Strategy Setup
    setupStrategyControl('min-companion-trump-value-select-p1', null, 'player1', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true);
    setupStrategyControl('min-trump-oder-mit-select-p1', null, 'player1', 'bidStage1', 'minTrumpForOderMit', false, false, true);
    
    // --- UPDATED P0 BID STAGE 2 CONTROLS ---
    setupStrategyControl('min-hand-value-play-sneaker-slider-p1', 'min-hand-value-play-sneaker-value-p1', 'player1', 'bidStage2', 'minHandValueToPlayWithSneaker', false, false, false);
    setupStrategyControl('play-if-last-no-one-joined-checkbox-p1', null, 'player1', 'bidStage2', 'playIfLastNoOneJoined', true, false, false);

    setupStrategyControl('max-trump-value-trumpfpackerl-select-p1', null, 'player1', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true);
    setupStrategyControl('consider-sau-if-planned-checkbox-p1', null, 'player1', 'exchange', 'considerSauIfPlanned', true, false, false);
    
    // Others Strategy Setup
    setupStrategyControl('min-companion-trump-value-select-others', null, 'otherPlayers', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true);
    setupStrategyControl('min-trump-oder-mit-select-others', null, 'otherPlayers', 'bidStage1', 'minTrumpForOderMit', false, false, true);

    // --- UPDATED OTHERS BID STAGE 2 CONTROLS ---
    setupStrategyControl('min-hand-value-play-sneaker-slider-others', 'min-hand-value-play-sneaker-value-others', 'otherPlayers', 'bidStage2', 'minHandValueToPlayWithSneaker', false, false, false);
    setupStrategyControl('play-if-last-no-one-joined-checkbox-others', null, 'otherPlayers', 'bidStage2', 'playIfLastNoOneJoined', true, false, false);

    setupStrategyControl('max-trump-value-trumpfpackerl-select-others', null, 'otherPlayers', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true);
    setupStrategyControl('consider-sau-if-planned-checkbox-others', null, 'otherPlayers', 'exchange', 'considerSauIfPlanned', true, false, false);

    initializeGame();

    const runSimButton = document.getElementById('run-simulation-button');
    const numGamesInput = document.getElementById('simulation-games-input');
    const resultsOutput = document.getElementById('simulation-results-output');
    const resultsContainer = document.getElementById('simulation-results-container');
    const chartContainer = document.getElementById('simulation-chart-container');
    const barChartArea = document.getElementById('bar-chart-area');
    const progressContainer = document.getElementById('simulation-progress-container');
    const progressBarFill = document.getElementById('simulation-progress-bar-fill');
    const progressText = document.getElementById('simulation-progress-text');

    if (runSimButton && numGamesInput && resultsOutput && resultsContainer && chartContainer && barChartArea && progressContainer && progressBarFill && progressText) {
        resultsContainer.style.display = 'block';
        chartContainer.style.display = 'block';
        resultsOutput.textContent = 'Run a simulation to see results.';
        barChartArea.innerHTML = ''; 

        runSimButton.addEventListener('click', async () => {
            const numGames = parseInt(numGamesInput.value, 10);
            if (isNaN(numGames) || numGames <= 0) {
                resultsOutput.textContent = "Please enter a valid number of games.";
                barChartArea.innerHTML = '';
                progressContainer.style.display = 'none';
                return;
            }

            runSimButton.disabled = true; runSimButton.textContent = 'Running...';
            resultsOutput.textContent = `Initializing simulation for ${numGames} games...`;
            barChartArea.innerHTML = ''; 

            progressContainer.style.display = 'block';
            progressBarFill.style.width = '0%';
            progressText.textContent = '0%';

            const updateProgressUI = (percentage) => {
                progressBarFill.style.width = `${percentage.toFixed(2)}%`;
                progressText.textContent = `${percentage.toFixed(0)}%`;
            };

            try {
                await new Promise(resolve => setTimeout(resolve, 50));
                const simulationResults = await runBatchSimulation(numGames, updateProgressUI);
                displaySimulationResults(simulationResults);
                displayBarChart(simulationResults);
                if(simulationResults.gamesCompleted === numGames) {
                    progressText.textContent = '100% Done';
                } else {
                    progressText.textContent = `Completed ${simulationResults.gamesCompleted}/${numGames}`;
                }
            } catch (error) {
                console.error("Error during batch simulation:", error);
                resultsOutput.textContent = `Error during simulation: ${error.message}`;
                progressText.textContent = 'Error!';
            } finally {
                runSimButton.disabled = false; runSimButton.textContent = 'Run Simulation';
            }
        });
    } else {
        console.warn("One or more simulation control/result/chart/progress elements are missing.");
    }

    function displaySimulationResults(results) {
        let outputText = `Simulation Complete:\n`;
        outputText += `Games Simulated: ${results.gamesSimulated}\n`;
        outputText += `Games Successfully Completed: ${results.gamesCompleted}\n\n`;
        outputText += `Total Points per Player:\n`;
        results.playerNames.forEach((name, index) => {
            const totalPts = results.totalPoints[index];
            const avgPts = results.gamesCompleted > 0 ? (totalPts / results.gamesCompleted).toFixed(2) : 'N/A';
            outputText += `${name || ('P'+index)}: ${totalPts.toFixed(1)} points (Avg: ${avgPts} per game)\n`;
        });
        resultsOutput.textContent = outputText;
    }

    function displayBarChart(results) {
        barChartArea.innerHTML = '';
        const points = results.totalPoints; 
        const playerNames = results.playerNames;
        let minPoint = 0; 
        let maxPoint = 0; 
        points.forEach(p => { 
            if (p < minPoint) minPoint = p; 
            if (p > maxPoint) maxPoint = p; 
        });

        const dataAbsMax = Math.max(Math.abs(minPoint), Math.abs(maxPoint)); // Max deviation from zero
        const chartHeight = 200; // Total height available for bars
        const zeroLinePosition = (dataAbsMax + minPoint) / (2 * dataAbsMax) * chartHeight; // Position of the zero line from bottom if dataAbsMax != 0
        const effectiveZeroLine = (dataAbsMax === 0) ? chartHeight / 2 : zeroLinePosition;


        points.forEach((point, index) => {
            const barContainer = document.createElement('div'); 
            barContainer.classList.add('bar-container');
            
            const barValue = document.createElement('div'); 
            barValue.classList.add('bar-value'); 
            barValue.textContent = point.toFixed(1);
            
            const bar = document.createElement('div'); 
            bar.classList.add('bar'); 
            bar.classList.add(`bar-p${index}`);

            let barHeight;
            if (dataAbsMax === 0) { // All points are zero
                barHeight = 1; // Minimal height for zero bar
                bar.style.bottom = `${effectiveZeroLine - 1}px`; // Center it
            } else {
                barHeight = (Math.abs(point) / dataAbsMax) * (chartHeight / 2); // Height relative to half chart height
                barHeight = Math.max(1, barHeight); // Ensure minimum visible height
                if (point >= 0) {
                    bar.style.bottom = `${effectiveZeroLine}px`;
                    bar.style.backgroundColor = '#5cb85c'; // Green for positive
                    bar.style.borderColor = '#4cae4c';
                } else {
                    bar.style.bottom = `${effectiveZeroLine - barHeight}px`;
                    bar.style.backgroundColor = '#d9534f'; // Red for negative
                    bar.style.borderColor = '#d43f3a';
                }
            }
            bar.style.height = `${barHeight}px`;
            
            const barLabel = document.createElement('div'); 
            barLabel.classList.add('bar-label'); 
            barLabel.textContent = playerNames[index] || `P${index}`;
            
            barContainer.appendChild(barValue); 
            barContainer.appendChild(bar); 
            barContainer.appendChild(barLabel); 
            barChartArea.appendChild(barContainer);
        });
         // Add a zero line if the range includes negative and positive values or just for reference
        if (minPoint < 0 && maxPoint > 0 || (minPoint === 0 && maxPoint === 0) || (dataAbsMax > 0)) {
            const zeroLine = document.createElement('div');
            zeroLine.style.position = 'absolute';
            zeroLine.style.left = '0';
            zeroLine.style.right = '0';
            zeroLine.style.bottom = `${effectiveZeroLine}px`;
            zeroLine.style.height = '1px';
            zeroLine.style.backgroundColor = '#aaa'; // Color of the zero line
            zeroLine.style.zIndex = '0'; // Behind bars if needed, or adjust
            barChartArea.appendChild(zeroLine);
        }
    }
});