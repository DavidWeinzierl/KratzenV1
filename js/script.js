import {
    initializeGame,
    nextStep,
    setDealerAnte,
    setMuasPenalty,
    updateStrategyParameter,
    setAnimationSpeed,
    setFailPenalty,
    setPointsPerTrick,
    runBatchSimulation,
    toggleOtherPlayersCardVisibility
} from './controller.js';

import { RANKS, SUITS, WELI_RANK, WELI_SUIT, getCardImageFilename } from './constants.js';
import { logMessage } from './logger.js';

// --- Preload all card images for smoother animations ---
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
    const minVirtualSpeed = 1;
    const maxVirtualSpeed = 10;
    const maxSeconds = 0.5; // Corresponds to minVirtualSpeed
    const minSeconds = 0.1; // Corresponds to maxVirtualSpeed

    const clampedVirtualSpeed = Math.max(minVirtualSpeed, Math.min(maxVirtualSpeed, virtualSpeed));

    if (maxVirtualSpeed === minVirtualSpeed) return maxSeconds;

    const seconds = maxSeconds - ( (clampedVirtualSpeed - minVirtualSpeed) * (maxSeconds - minSeconds) ) / (maxVirtualSpeed - minVirtualSpeed);
    return parseFloat(seconds.toFixed(2));
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("DOM Loaded. Initializing Simulation.");

    await preloadCardImages();

    // --- START SCREEN LOGIC ---
    const playButton = document.getElementById('play-button');
    const startOverlay = document.getElementById('start-overlay');
    
    if (playButton && startOverlay) {
        playButton.addEventListener('click', async () => {
            
            // --- FIX: This is the new, more reliable mobile detection logic ---
            // It checks for touch capability AND a "phone-like" screen width.
            const hasTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
            const isLikelyMobile = hasTouch && window.innerWidth <= 920; // 920px covers most phones/small tablets in landscape

            if (isLikelyMobile) {
                logMessage("Mobile device detected. Attempting fullscreen and landscape lock.");
                const docEl = document.documentElement;
                const orientationLockSupported = 'orientation' in screen && typeof screen.orientation.lock === 'function';

                try {
                    if (docEl.requestFullscreen) {
                        await docEl.requestFullscreen();
                    } else if (docEl.webkitRequestFullscreen) { // Safari
                        await docEl.webkitRequestFullscreen();
                    }
                    
                    if (orientationLockSupported) {
                        await screen.orientation.lock('landscape');
                        logMessage("Entered fullscreen and locked orientation to landscape.");
                    } else {
                        logMessage("Entered fullscreen, but orientation lock is not supported.");
                    }
                } catch (err) {
                    logMessage(`Could not enter fullscreen or lock orientation: ${err.message}`);
                    console.error("Fullscreen/Lock Error:", err);
                }
            } else {
                logMessage("Desktop or large tablet detected, skipping fullscreen.");
            }
            // --- END OF FIX ---


            // This part runs for both mobile and desktop
            startOverlay.style.display = 'none';
            
            document.getElementById('game-board').style.display = 'block';
            document.getElementById('main-controls-container').style.display = 'flex';
            document.getElementById('log-container').style.display = 'block';
            document.getElementById('simulation-container').style.display = 'flex';
            
            initializeGame();
        });
    } else {
        // Fallback for development if the start screen is removed
        console.warn("#play-button or #start-overlay not found. Bypassing start screen.");
        document.getElementById('game-board').style.display = 'block';
        document.getElementById('main-controls-container').style.display = 'flex';
        document.getElementById('log-container').style.display = 'block';
        document.getElementById('simulation-container').style.display = 'flex';
        initializeGame();
    }
    
    // ... (The rest of the file remains exactly the same and is omitted for brevity) ...

    const animationSpeedSlider = document.getElementById('animation-speed-slider');
    const animationSpeedValueSpan = document.getElementById('animation-speed-value');
    const dealerAnteSlider = document.getElementById('dealer-ante-slider');
    const dealerAnteValueSpan = document.getElementById('dealer-ante-value');
    const muasPenaltySlider = document.getElementById('no-loser-penalty-slider');
    const muasPenaltyValueSpan = document.getElementById('no-loser-penalty-value');
    const hideCardsToggleButton = document.getElementById('hide-cards-toggle');
    const failPenaltySlider = document.getElementById('fail-penalty-slider');
    const failPenaltyValueSpan = document.getElementById('fail-penalty-value');
    const pointsPerTrickSlider = document.getElementById('points-per-trick-slider');
    const pointsPerTrickValueSpan = document.getElementById('points-per-trick-value');

    function setupStrategyControl(inputId, valueDisplayId, targetGroup, category, parameterName, isCheckbox = false, isFloat = false, isSelect = false) {
        const inputElement = document.getElementById(inputId);
        const valueDisplayElement = valueDisplayId ? document.getElementById(valueDisplayId) : null;
        if (!inputElement) { console.warn(`Strategy control element not found: #${inputId}`); return; }
        let initialValue = isCheckbox ? inputElement.checked : isSelect ? inputElement.value : isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10);
        if (valueDisplayElement && !isCheckbox && !isSelect) { valueDisplayElement.textContent = isFloat ? initialValue.toFixed(2) : initialValue.toString(); }
        updateStrategyParameter(targetGroup, category, parameterName, initialValue);
        inputElement.addEventListener(isCheckbox || isSelect ? 'change' : 'input', () => {
            let currentValue = isCheckbox ? inputElement.checked : isSelect ? inputElement.value : isFloat ? parseFloat(inputElement.value) : parseInt(inputElement.value, 10);
            if (valueDisplayElement && !isCheckbox && !isSelect) { valueDisplayElement.textContent = isFloat ? currentValue.toFixed(2) : currentValue.toString(); }
            updateStrategyParameter(targetGroup, category, parameterName, currentValue);
        });
    }

    if (hideCardsToggleButton) { hideCardsToggleButton.addEventListener('click', toggleOtherPlayersCardVisibility); } 
    else { console.warn("Hide Cards Toggle button not found!"); }
    if (animationSpeedSlider && animationSpeedValueSpan) {
        const initialVirtualSpeed = parseInt(animationSpeedSlider.value, 10);
        animationSpeedValueSpan.textContent = initialVirtualSpeed.toString();
        setAnimationSpeed(mapVirtualSpeedToSeconds(initialVirtualSpeed));
        animationSpeedSlider.addEventListener('input', () => {
            const virtualSpeed = parseInt(animationSpeedSlider.value, 10);
            animationSpeedValueSpan.textContent = virtualSpeed.toString();
            setAnimationSpeed(mapVirtualSpeedToSeconds(virtualSpeed));
        });
    } else { console.warn("Animation speed slider or value display not found!"); }
    if (dealerAnteSlider && dealerAnteValueSpan) {
        const initialAnte = parseFloat(dealerAnteSlider.value);
        dealerAnteValueSpan.textContent = initialAnte.toFixed(1);
        setDealerAnte(initialAnte);
        dealerAnteSlider.addEventListener('input', () => { const value = parseFloat(dealerAnteSlider.value); dealerAnteValueSpan.textContent = value.toFixed(1); setDealerAnte(value); });
    } else { console.warn("Dealer Ante slider or value display not found!"); }
    if (muasPenaltySlider && muasPenaltyValueSpan) {
        const initialPenalty = parseFloat(muasPenaltySlider.value);
        muasPenaltyValueSpan.textContent = initialPenalty.toFixed(1);
        setMuasPenalty(initialPenalty);
        muasPenaltySlider.addEventListener('input', () => { const value = parseFloat(muasPenaltySlider.value); muasPenaltyValueSpan.textContent = value.toFixed(1); setMuasPenalty(value); });
    } else { console.warn('"Muas" Penalty slider or value display not found!'); }
    if (failPenaltySlider && failPenaltyValueSpan) {
        const initialPenalty = parseInt(failPenaltySlider.value, 10);
        failPenaltyValueSpan.textContent = initialPenalty.toString();
        setFailPenalty(initialPenalty);
        failPenaltySlider.addEventListener('input', () => { const value = parseInt(failPenaltySlider.value, 10); failPenaltyValueSpan.textContent = value.toString(); setFailPenalty(value); });
    } else { console.warn("Fail Penalty slider or value display not found!"); }
    if (pointsPerTrickSlider && pointsPerTrickValueSpan) {
        const initialPoints = parseFloat(pointsPerTrickSlider.value);
        pointsPerTrickValueSpan.textContent = initialPoints.toFixed(1);
        setPointsPerTrick(initialPoints);
        pointsPerTrickSlider.addEventListener('input', () => { const value = parseFloat(pointsPerTrickSlider.value); pointsPerTrickValueSpan.textContent = value.toFixed(1); setPointsPerTrick(value); });
    } else { console.warn("Points per Trick slider or value display not found!"); }

    setupStrategyControl('min-companion-trump-value-select-p1', null, 'player1', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true);
    setupStrategyControl('min-trump-oder-mit-select-p1', null, 'player1', 'bidStage1', 'minTrumpForOderMit', false, false, true);
    setupStrategyControl('min-hand-value-play-sneaker-slider-p1', 'min-hand-value-play-sneaker-value-p1', 'player1', 'bidStage2', 'minHandValueToPlayWithSneaker');
    setupStrategyControl('min-hand-value-play-oderer-slider-p1', 'min-hand-value-play-oderer-value-p1', 'player1', 'bidStage2', 'minHandValueToPlayWithOderer');
    setupStrategyControl('max-trump-value-trumpfpackerl-select-p1', null, 'player1', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true);
    setupStrategyControl('consider-sau-if-planned-checkbox-p1', null, 'player1', 'exchange', 'considerSauIfPlanned', true);
    setupStrategyControl('min-companion-trump-value-select-others', null, 'otherPlayers', 'bidStage1', 'minCompanionTrumpValueForSneak', false, false, true);
    setupStrategyControl('min-trump-oder-mit-select-others', null, 'otherPlayers', 'bidStage1', 'minTrumpForOderMit', false, false, true);
    setupStrategyControl('min-hand-value-play-sneaker-slider-others', 'min-hand-value-play-sneaker-value-others', 'otherPlayers', 'bidStage2', 'minHandValueToPlayWithSneaker');
    setupStrategyControl('min-hand-value-play-oderer-slider-others', 'min-hand-value-play-oderer-value-others', 'otherPlayers', 'bidStage2', 'minHandValueToPlayWithOderer');
    setupStrategyControl('max-trump-value-trumpfpackerl-select-others', null, 'otherPlayers', 'exchange', 'maxTrumpValueForTrumpfPackerl', false, false, true);
    setupStrategyControl('consider-sau-if-planned-checkbox-others', null, 'otherPlayers', 'exchange', 'considerSauIfPlanned', true);

    const runSimButton = document.getElementById('run-simulation-button');
    const numGamesInput = document.getElementById('simulation-games-input');
    const resultsOutput = document.getElementById('simulation-results-output');
    const resultsContainer = document.getElementById('simulation-results-container');
    const chartContainer = document.getElementById('simulation-chart-container');
    const barChartArea = document.getElementById('bar-chart-area');
    const progressContainer = document.getElementById('simulation-progress-container');
    const progressBarFill = document.getElementById('simulation-progress-bar-fill');
    const progressText = document.getElementById('simulation-progress-text');

    if (runSimButton) {
        resultsContainer.style.display = 'block';
        chartContainer.style.display = 'block';
        resultsOutput.textContent = 'Run a simulation to see results.';
        barChartArea.innerHTML = ''; 

        runSimButton.addEventListener('click', async () => {
            const numGames = parseInt(numGamesInput.value, 10);
            if (isNaN(numGames) || numGames <= 0) { resultsOutput.textContent = "Please enter a valid number of games."; barChartArea.innerHTML = ''; progressContainer.style.display = 'none'; return; }
            runSimButton.disabled = true; runSimButton.textContent = 'Running...';
            resultsOutput.textContent = `Initializing simulation for ${numGames} games...`;
            barChartArea.innerHTML = ''; 
            progressContainer.style.display = 'block';
            progressBarFill.style.width = '0%';
            progressText.textContent = '0%';
            const updateProgressUI = (percentage) => { progressBarFill.style.width = `${percentage.toFixed(2)}%`; progressText.textContent = `${percentage.toFixed(0)}%`; };
            try {
                await new Promise(resolve => setTimeout(resolve, 50));
                const simulationResults = await runBatchSimulation(numGames, updateProgressUI);
                displaySimulationResults(simulationResults);
                displayBarChart(simulationResults);
                if(simulationResults.gamesCompleted === numGames) { progressText.textContent = '100% Done'; } 
                else { progressText.textContent = `Completed ${simulationResults.gamesCompleted}/${numGames}`; }
            } catch (error) { console.error("Error during batch simulation:", error); resultsOutput.textContent = `Error during simulation: ${error.message}`; progressText.textContent = 'Error!'; } 
            finally { runSimButton.disabled = false; runSimButton.textContent = 'Run Simulation'; }
        });
    } else { console.warn("One or more simulation control/result/chart/progress elements are missing."); }

    function displaySimulationResults(results) {
        let outputText = `Simulation Complete:\nGames Simulated: ${results.gamesSimulated}\nGames Successfully Completed: ${results.gamesCompleted}\n\nTotal Points per Player:\n`;
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
        let minPoint = 0, maxPoint = 0;
        points.forEach(p => { if (p < minPoint) minPoint = p; if (p > maxPoint) maxPoint = p; });
        const dataAbsMax = Math.max(Math.abs(minPoint), Math.abs(maxPoint));
        const chartHeight = 200;
        const zeroLinePosition = (dataAbsMax + minPoint) / (2 * dataAbsMax) * chartHeight;
        const effectiveZeroLine = (dataAbsMax === 0) ? chartHeight / 2 : zeroLinePosition;
        points.forEach((point, index) => {
            const barContainer = document.createElement('div'); barContainer.classList.add('bar-container');
            const barValue = document.createElement('div'); barValue.classList.add('bar-value'); barValue.textContent = point.toFixed(1);
            const bar = document.createElement('div'); bar.classList.add('bar', `bar-p${index}`);
            let barHeight = dataAbsMax === 0 ? 1 : Math.max(1, (Math.abs(point) / dataAbsMax) * (chartHeight / 2));
            if (dataAbsMax === 0) { bar.style.bottom = `${effectiveZeroLine - 1}px`; }
            else { if (point >= 0) { bar.style.bottom = `${effectiveZeroLine}px`; bar.style.backgroundColor = '#5cb85c'; bar.style.borderColor = '#4cae4c'; } 
                   else { bar.style.bottom = `${effectiveZeroLine - barHeight}px`; bar.style.backgroundColor = '#d9534f'; bar.style.borderColor = '#d43f3a'; } }
            bar.style.height = `${barHeight}px`;
            const barLabel = document.createElement('div'); barLabel.classList.add('bar-label'); barLabel.textContent = playerNames[index] || `P${index}`;
            barContainer.appendChild(barValue); barContainer.appendChild(bar); barContainer.appendChild(barLabel); barChartArea.appendChild(barContainer);
        });
        if (minPoint < 0 && maxPoint > 0 || (minPoint === 0 && maxPoint === 0) || (dataAbsMax > 0)) {
            const zeroLine = document.createElement('div');
            zeroLine.style.cssText = `position:absolute; left:0; right:0; bottom:${effectiveZeroLine}px; height:1px; background-color:#aaa; z-index:0;`;
            barChartArea.appendChild(zeroLine);
        }
    }

    document.addEventListener('keydown', (event) => {
        const activeElement = document.activeElement;
        if (activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)) { return; }
        if (event.code === 'Space') {
            event.preventDefault();
            const nextStepButton = document.getElementById('dynamic-next-step');
            if (nextStepButton && !nextStepButton.disabled) { nextStepButton.click(); }
        }
    });
});