import * as clipboard from "clipboard-polyfill/text";
import { auth, db } from "./src/firebaseConfig";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import confetti from "canvas-confetti";

// Layer Definitions (Module Scope)
const LAYER_DEFS = {
    'QWERTY': [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['Z', 'X', 'C', 'V', 'B', 'N', 'M']
    ],
    'DVORAK': [
        ['P', 'Y', 'F', 'G', 'C', 'R', 'L'],
        ['A', 'O', 'E', 'U', 'I', 'D', 'H', 'T', 'N', 'S'],
        ['Q', 'J', 'K', 'X', 'B', 'M', 'W', 'V', 'Z']
    ],
    'ALPHA': [
        ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
        ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R'],
        ['S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z']
    ]
};

// Alpine.data('wordletApp', () => ({
export default () => ({
    title: 'WordLetta',
    version: '1.8.6',
    user: null,
    wordLength: 6,
    totalGuesses: 6,
    correctLetters: 0,
    cursor: 1,
    hardMode: false,
    isShaking: false, // New state for shake animation
    isClearing: false,
    isWinner: false,
    isLoser: false,
    isReadyToCheck: false,

    // PWA State
    installPrompt: null,
    showInstallPrompt: false,
    dictionaryDef: null,
    dailyChallengeInProgress: false,
    showNewGameModal: true,
    showShareModal: false,
    showStatsModal: false,
    showSettingsModal: false,
    showReleaseNotesModal: false,
    showHelpModal: false,
    showVolumePopover: false,
    dailyChallenge: false,
    dailyChallengeComplete: false,
    answer: null,
    toastMessage: '',
    showToast: false,
    settings: {
        sound: true,
        music: true,
        musicVolume: 0.3,
        lastVolume: 0.3, // Remembers volume for unmute
        haptics: true,

        theme: 'light', // 'light', 'dark', 'contrast'
        keyboardLayout: 'QWERTY'
    },
    // Timer State
    gameTime: 0,
    timerInterval: null,
    isPaused: false,
    timerStarted: false,
    pausedByModal: false,
    idleTimeout: null,

    // Music State
    bgMusic: null,
    isTweening: false,


    resetIdleTimer() {
        if (this.idleTimeout) clearTimeout(this.idleTimeout);
        if (this.timerStarted && !this.isPaused && !this.isWinner && !this.isLoser) {
            this.idleTimeout = setTimeout(() => {
                this.togglePause();
            }, 60000); // 1 minute
        }
    },

    // init() removed (merged into main init below)
    setupWatchers() {
        this.$watch('showSettingsModal', (value) => {
            if (value) {
                // Modal Opening: Pause if running
                if (this.timerStarted && !this.isPaused && !this.isWinner && !this.isLoser) {
                    this.togglePause();
                    this.pausedByModal = true;
                }
            } else {
                // Modal Closing: Resume if it was paused by modal
                if (this.timerStarted && this.isPaused && !this.isWinner && !this.isLoser) {
                    if (this.pausedByModal) {
                        this.togglePause();
                        this.pausedByModal = false;
                    }
                }
            }
        });
        this.$watch('showHelpModal', (value) => {
            if (value) {
                if (this.timerStarted && !this.isPaused && !this.isWinner && !this.isLoser) {
                    this.togglePause();
                    this.pausedByModal = true;
                }
                this.updateMusicState();
            } else {
                if (this.timerStarted && this.isPaused && !this.isWinner && !this.isLoser) {
                    if (this.pausedByModal) {
                        this.togglePause();
                        this.pausedByModal = false;
                    }
                }
                this.updateMusicState();
            }
        });

        this.$watch('showReleaseNotesModal', (value) => {
            if (value) {
                if (this.timerStarted && !this.isPaused && !this.isWinner && !this.isLoser) {
                    this.togglePause();
                    this.pausedByModal = true;
                }
            } else {
                if (this.timerStarted && this.isPaused && !this.isWinner && !this.isLoser && this.pausedByModal) {
                    this.togglePause();
                    this.pausedByModal = false;
                }
            }
        });

        // Watch for New Game modal to handle music start
        this.$watch('showNewGameModal', (value) => {
            // giving a slight delay to allow interaction to register if it's the first close
            setTimeout(() => { this.updateMusicState(); }, 100);
        });

        // PWA Install Prompt Listener
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.installPrompt = e;
            this.showInstallPrompt = true;
        });

        // Register Service Worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('./sw.js');
        }

    },

    LAYER_DEFS: { // Kept for reference or if used elsewhere, but we found it's in module scope now.
        // Actually, I removed LAYER_DEFS from here in v1.7.1, so this block might be gone or I shouldn't touch it if it's not there.
        // Let's target the properties directly.
    },
    alphabet: LAYER_DEFS['QWERTY'].flat(), // SAFETY: Initialize with QWERTY flat array
    keyboardRows: LAYER_DEFS['QWERTY'], // SAFETY: Initialize with QWERTY by default
    alphabetStatus: [],
    guessStatus: [],
    boxStatus: [],
    letters: [],
    guesses: [],
    validWordList: [],
    wordList: [],
    shareSquares: ['', '🟡', '🟢'],
    shareCopy: 'I love WordLetta!',
    kudos: [
        "",
        "Wait, what?! You got it ON THE FIRST TRY!",
        "TERRIFIC! You nailed it in 2!",
        "Only 3 guesses? Very nicely done!",
        "You got it in 4!",
        "A tricky one, but you pulled it out in 5!",
        "Just got it on your last try!",
    ],
    sharePhrases: [
        "Genius!",
        "Magnificent!",
        "Impressive!",
        "Splendid!",
        "Great!",
        "Phew!",
        "Close one!",
        "Unstoppable!",
        "Sharp!",
        "Brilliant!"
    ],
    endlessStats: [], // Removed Alpine.$persist to rely on Firestore/Local merge logic manually if needed, or keeping it for offline support? 
    // actually keeping it simple: use local unless logged in.
    // For now, let's keep it as array and init in init()
    dailyStats: Alpine.$persist([]), // Keep daily local for now

    get shareBlurb() {
        // build 'colored dots' grid for sharing right/wrong guesses
        if (!this.numGuesses) return
        // const arr = ["010112","200012","210110","211102","222222"]  // replace with this.guessStatus
        let newArr = []
        this.guessStatus.forEach(g => {
            // Mirror exact positions (removed sort().reverse())
            let str = g.split('').join('').replaceAll('0', '⚪').replaceAll('1', '🟡').replaceAll('2', '🟢')
            newArr.push(str || '⚪')
        })
        return newArr.join('\n')
    },
    get guessDistribution() {
        // return array of 6 integers representing wins at each guess count
        if (!this.endlessStats) return [0, 0, 0, 0, 0, 0]
        let dist = [0, 0, 0, 0, 0, 0]
        this.endlessStats.filter(g => g.isWinner).forEach(g => {
            if (g.numGuesses >= 1 && g.numGuesses <= 6) {
                dist[g.numGuesses - 1]++
            }
        })
        return dist
    },
    get guessPieChartStyle() {
        const dist = this.guessDistribution;
        const total = dist.reduce((a, b) => a + b, 0);
        if (total === 0) return 'background: conic-gradient(#cbd5e1 0% 100%)'; // slate-300

        const colors = [
            '#10b981', // 1 - emerald-500
            '#34d399', // 2 - emerald-400
            '#6ee7b7', // 3 - emerald-300
            '#fcd34d', // 4 - amber-300
            '#fbbf24', // 5 - amber-400
            '#f43f5e'  // 6 - rose-500
        ];

        let gradient = 'background: conic-gradient(';
        let currentPer = 0;

        dist.forEach((count, i) => {
            if (count > 0) {
                const per = (count / total) * 100;
                gradient += `${colors[i]} ${currentPer}% ${currentPer + per}%, `;
                currentPer += per;
            }
        });

        return gradient.replace(/, $/, ')');
    },
    get recentHistory() {
        return this.endlessStats ? this.endlessStats.slice().reverse().slice(0, 50) : []
    },
    get userGames() { return this.endlessStats && this.endlessStats.length },
    get userWins() { return this.endlessStats && this.endlessStats.filter(g => g.isWinner).length },
    get userLosses() { return this.endlessStats && this.endlessStats.filter(g => !g.isWinner).length },
    get userWinPct() { return Math.round((this.userWins / this.userGames) * 100) },
    get isMobile() {
        return (('ontouchstart' in window) ||
            (navigator.maxTouchPoints > 0) ||
            (navigator.msMaxTouchPoints > 0));
    },
    get guess() { return this.letters.length ? this.letters.join('').toLowerCase() : null },
    get numGuesses() { return this.guesses ? this.guesses.length : 0 },
    get dailyChallengeDay() {
        const now = new Date()
        const start = new Date(2025, 1, 0)
        const diff = Number(now) - Number(start)
        return Math.floor(diff / (1000 * 60 * 60 * 24))
    },
    get currentStreak() {
        if (!this.dailyStats) return 0;
        let s = 0;
        let day = this.dailyChallengeDay;
        // If today is not played yet, check streak starting from yesterday
        if (!this.dailyStats[day]) day--;

        while (day >= 0) {
            if (this.dailyStats[day] && this.dailyStats[day].isWinner) {
                s++;
                day--;
            } else {
                break;
            }
        }
        return s;
    },
    get fireLevel() {
        let s = this.currentStreak;
        if (s >= 30) return 3; // "Hot"
        if (s >= 7) return 2;  // "Warmer"
        if (s >= 2) return 1;  // "Warm"
        return 0;
    },
    async fetchWordList(num, level = '') {
        if (!num) return false
        // NOTE: ensure a non-hardMode /words/*.js file exists
        if (num == 1 || num > 6) this.hardMode = true
        let url = './words/' + num + '-letters.js'
        let hardUrl = './words/' + num + '-letters-hard.js'
        // always fetch hardUrl for valid word comparison
        let response = await fetch(hardUrl)
        this.validWordList = await response.json()
        // if daily challenge, pick from special word list
        if (this.dailyChallenge && !this.dailyChallengeComplete) {
            // console.log('dC fetchWordList');
            this.hardMode = false
            this.wordLength = 6
            let response = await fetch('./words/daily-challenge.js')
            this.wordList = await response.json()
        }
        else if (!this.hardMode) {
            let response = await fetch(url)
            this.wordList = await response.json()
        }
        else if (this.hardMode) {
            let response = await fetch(hardUrl)
            this.wordList = await response.json()
        }
        response = null
    },
    async init() {
        this.setupWatchers(); // Initialize watchers
        this.startTime = new Date();
        // auth check
        if (auth) {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    this.user = user;
                    this.syncStats(); // This will also sync settings
                } else {
                    this.user = null;
                    this.loadData();
                    const local = localStorage.getItem('_x_endlessStats');
                    if (local) this.endlessStats = JSON.parse(local);
                }
            });
        } else {
            console.log("Firebase Auth not initialized (dev mode)");
            this.loadLocalSettings();
            const local = localStorage.getItem('_x_endlessStats');
            if (local) this.endlessStats = JSON.parse(local);
        }

        // daily challenge complete?
        if (this.dailyStats[this.dailyChallengeDay]) this.dailyChallengeComplete = true

        // init letter boxes (reset on wordLength change) & alphabet status
        this.letters = []
        this.boxStatus = []

        this.$watch('wordLength', len => {
            this.letters.length = len
            this.boxStatus.length = len
            for (let i = 0; i < len; i++) {
                this.letters[i] = ''
                this.boxStatus[i] = ''
            }
            // Disable Hard Mode for 1-letter games (it's silly)
            if (len === 1) this.hardMode = false;
            // Reset cursor to 0 to align with new letters array
            this.cursor = 0;
        })

        for (let i = 0; i < this.wordLength; i++) {
            this.letters[i] = ''
            this.boxStatus[i] = ''
        }

        // Initialize alphabet status. 
        // Note: loadLocalSettings() is called before this in init(), so alphabet and status should be ready?
        // Actually loadLocalSettings calls setKeyboardLayout which sets this.alphabet.
        // But we need to ensure alphabetStatus is sized correctly if not already.
        // Initialize alphabet status. 
        // Always reset for a new game!
        this.alphabetStatus = new Array(this.alphabet.length).fill('');

        // fetch wordList & pick a random answer
        await this.fetchWordList(this.wordLength, (this.hardMode) ? 'hard' : '')
        // pick an answer
        // if (this.dailyChallenge && !this.dailyChallengeComplete) {
        if (this.dailyChallenge && !this.dailyChallengeComplete && this.wordList[this.dailyChallengeDay]) {
            // get {days since 1/1/2025} element of daily-challenge list | // https://github.com/yyx990803/vue-wordle/blob/main/src/words.ts
            console.log(this.dailyChallengeDay);
            this.answer = this.wordList[this.dailyChallengeDay].toUpperCase()
        } else {
            // or, just grab a random word
            this.answer = this.wordList[Math.floor(Math.random() * this.wordList.length)].toUpperCase()
        }
        // console.log('word + answer', this.wordLength, this.answer)

        // reset
        this.guessStatus = []
        this.guesses = []
        this.cursor = 0
        this.isWinner = false
        this.isLoser = false
        this.stopTimer();
        this.timerStarted = false;
        this.gameTime = 0;
        this.updateMusicState();

    },
    async installPWA() {
        if (!this.installPrompt) return;
        this.installPrompt.prompt();
        const { outcome } = await this.installPrompt.userChoice;
        this.installPrompt = null;
        this.showInstallPrompt = false;
    },
    dismissInstall() {
        this.showInstallPrompt = false;
    },
    keyPressed() {
        // handle keyboard events
        const k = this.$event.key

        // special characters
        if (k == "Backspace") { this.backspace() }
        if (k == "Enter") { this.enter() }
        if (k == "Escape") {
            this.showStatsModal = false
            this.showNewGameModal = false
            this.showSettingsModal = false
        }

        // only respond to letters A-Z
        if ((/^[a-z]$/i).test(k)) {
            this.letterClicked(k.toUpperCase())
        }
    },
    // PWA State
    installPrompt: null,
    showInstallPrompt: false,
    dictionaryDef: null, // Dictionary Definition
    // ...
    async restoreDailyGame() {
        console.log("Explicitly restoring Daily Challenge...");
        this.dailyChallenge = true;
        this.showNewGameModal = false;

        // Ensure user is logged in for the restore flow to work effectively 
        // (though we already checked this in syncStats to set the flag)

        // Re-run the restore logic that was previously in syncStats
        // Ideally we should have cached the data object, but we might need to re-fetch if we didn't save it.
        // Actually, syncStats runs on load. If we want to restore "later", we need the data.
        // Let's re-fetch to be safe and simple, or store 'pendingRestoreData'.
        // Storing 'pendingRestoreData' is better than another network call if possible, but 
        // to keep it stateless between modal open/close, let's just re-fetch the user doc or use the local flag + logic?
        // Wait, 'data' is local to syncStats. 
        // We should move the restore logic into this function and call it from syncStats IF we wanted auto-restore.
        // But now we want manual restore.

        // Efficient way: syncStats just sets the flag. 
        // restoreDailyGame calls a new helper or does the work.
        // We need to fetch the data again OR access `this.endlessStats`? No, dailyProgress is separate.

        if (!this.user) return; // Should not happen if flag is set

        // We'll do a quick fetch to ensure fresh state
        const userRef = doc(db, "users", this.user.uid);
        const docSnap = await getDoc(userRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            if (data.dailyProgress) {
                // Restore Timer
                this.gameTime = data.dailyProgress.gameTime || 0;

                // Fetch Words
                try {
                    let response = await fetch('./words/daily-challenge.js');
                    this.wordList = await response.json();
                    this.wordLength = 6;
                    this.hardMode = false;
                } catch (e) { console.error("Error fetching daily words for restore", e); }

                if (this.wordList[this.dailyChallengeDay]) {
                    this.answer = this.wordList[this.dailyChallengeDay].toUpperCase();
                }

                // Restore Guesses
                const savedGuesses = data.dailyProgress.guesses || [];
                this.guesses = [];
                this.guessStatus = [];
                this.alphabetStatus = new Array(this.alphabet.length).fill('');

                savedGuesses.forEach(g => {
                    this.guesses.push(g);
                    // Re-calculate local state (colors)
                    let answerClone = this.answer.split('');
                    let currentBoxStatus = new Array(6).fill(0);
                    let letters = g.split('');

                    letters.forEach((l, i) => {
                        if (l === answerClone[i]) {
                            this.alphabetStatus[this.alphabet.indexOf(l)] = 2;
                            currentBoxStatus[i] = 2;
                            answerClone[i] = null;
                        }
                    });
                    letters.forEach((l, i) => {
                        if (l && answerClone.includes(l)) {
                            if (this.alphabetStatus[this.alphabet.indexOf(l)] !== 2) this.alphabetStatus[this.alphabet.indexOf(l)] = 1;
                            if (!currentBoxStatus[i]) currentBoxStatus[i] = 1;
                            answerClone[answerClone.indexOf(l)] = null;
                        } else if (l) {
                            if (this.alphabetStatus[this.alphabet.indexOf(l)] === '') this.alphabetStatus[this.alphabet.indexOf(l)] = 0;
                        }
                    });
                    this.guessStatus.push(currentBoxStatus.join(''));
                });
                this.showMessage("Daily Challenge Restored", 3000);
            }
        }
    },
    newGame(force = false) {
        // REMOVED native confirm() as per request.
        // Logic for "game in progress" check should happen in the UI before calling this with force=true,
        // OR we implement a custom modal confirmation flow here.
        // For now, simpler: The UI buttons (Endless/Daily) should check state.
        // But if they click "Endless" while playing Daily?

        // We will trust the UI to handle the confirmation interaction (e.g. "Abandon?" button)
        // or we just reset.
        // If current game is Daily and In Progress, and they clicked Endless?
        // We need a way to stop them.

        if (this.dailyChallenge && this.numGuesses > 0 && !this.isWinner && !this.isLoser && !force) {
            // We can't use native alert.
            // We'll show a toast for now, or assume the UI handles it.
            // User said: "If a user selects an Endless Challenge while a Daily Challenge is active, a Javascript alert pops up... Don't ever."
            // So I need to NOT do that.
            // Let's use showMessage for now as a "soft" block?
            this.showMessage("Finish your Daily Challenge first!");
            return;
        }

        // Proceed with reset
        this.showStatsModal = false
        this.showNewGameModal = false
        this.dictionaryDef = null;

        // Clear Daily flag if we are starting a NEW game (Endless or fresh Daily)
        // If we are starting Endless, definitely clear it.
        // If we are starting Daily, we might be starting *fresh* or restoring. 
        // This function is called for "New Game" (fresh). restoreDailyGame handles restore.

        // If we are explicitly starting a new game, we wipe the "In Progress" UI state locally?
        // No, the in-progress state comes from the DB. 
        // If they abandon it, we should probably wipe it from the DB too?
        // That's complex. Let's just let them play Endless.

        // Reset local state
        this.gameTime = 0;
        this.init();
    },
    async lookupDefinition() {
        if (!this.answer) return;
        try {
            const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${this.answer}`);
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                // Get first definition of first meaning
                const firstMeaning = data[0].meanings[0];
                if (firstMeaning && firstMeaning.definitions.length > 0) {
                    this.dictionaryDef = {
                        word: data[0].word,
                        phonetic: data[0].phonetic,
                        partOfSpeech: firstMeaning.partOfSpeech,
                        definition: firstMeaning.definitions[0].definition
                    };
                } else {
                    this.dictionaryDef = { definition: "No definition found." };
                }
            } else {
                this.dictionaryDef = { definition: "No definition found." };
            }
        } catch (e) {
            console.error("Dictionary lookup failed", e);
            this.dictionaryDef = { definition: "Could not fetch definition." };
        }
    },
    evaluateGuess() {
        // reset
        this.boxStatus = []
        this.correctLetters = 0

        // set 0 buffer for guessStatus (avoid 'undefined')
        this.guessStatus[this.numGuesses] = ''

        // set clone of answer (to remove letters when matched)
        let answerClone = this.answer.split('')
        // console.log(this.answer, answerClone, this.letters);

        // reset all letters in guess to default of 0
        // this.letters.forEach(g => { this.alphabetStatus[this.alphabet.indexOf(g)] = (g) ? 0 : null })

        // iterate over each guessed letter, checking each letter of answer
        // 1. iterate over each letter in answer looking for right/right
        this.letters.forEach((g, index) => {
            // console.log(g, index, answerClone[index]);
            if (g == answerClone[index]) {
                this.alphabetStatus[this.alphabet.indexOf(g)] = 2
                this.boxStatus[index] = 2
                this.correctLetters++
                // remove matches from answer array (to prevent dupe matches)
                answerClone[answerClone.indexOf(g)] = null
                // console.log(g, 'right!', 'box:', this.boxStatus[index])
                // console.log(g, 'right!', 'box:', this.boxStatus[index])
                this.playSound('match');
                // Subtle haptic for finding a letter? Maybe too much. Let's stick to playSound triggering it, 
                // but playSound('match') isn't defined in the main switch yet.
                // Let's add it there or just call it directly.
                // Actually, let's just leave it to the audio sync or add a tiny tick here.
                // this.triggerHaptic('match'); 
            }
        });
        // console.log(answerClone)

        this.letters.forEach((g, index) => {
            // 2. look for right letter, wrong position
            if (g) {  // make sure there's a letter!
                // console.log(index, g, this.boxStatus[index])
                if (answerClone.includes(g)) {
                    // console.log('right/wrong', g)
                    if (this.alphabetStatus[this.alphabet.indexOf(g)] !== 2) this.alphabetStatus[this.alphabet.indexOf(g)] = 1
                    if (!this.boxStatus[index]) this.boxStatus[index] = 1
                    // remove matches from answer array (to prevent dupe matches)
                    answerClone[answerClone.indexOf(g)] = null
                }
            }
        })

        // set boxStatus & copy to guessStatus (0-wrong, 1-right/wrong, 2-right/right)
        this.letters.forEach((g, index) => {
            if (!this.boxStatus[index]) this.boxStatus[index] = 0
            if (this.alphabetStatus[this.alphabet.indexOf(g)] == '') this.alphabetStatus[this.alphabet.indexOf(g)] = 0
            this.guessStatus[this.numGuesses] += (this.boxStatus[index]) ? this.boxStatus[index] : '0'
        })

        // DELAYED SUBMISSION (Animation Logic)
        // 1. User sees "Right/Wrong" colors on active row (already set above via boxStatus)
        // 2. Wait 1s
        // 3. Trigger "Clearing" (Fade Down)
        // 4. Slide In new row (push to guesses) & Reset Active Row

        // game on. done evaluating current guess, reset cursor & ready check
        this.isReadyToCheck = false
        // keep cursor at end to prevent typing during animation
        // if (this.cursor == this.wordLength) this.cursor = 0

        setTimeout(() => {
            // Simultaneous Start:
            // A. Start fading/dropping the active row
            this.isClearing = true; // This triggers opacity-0 on the input box

            // B. Push latest guess to history (triggers slide-in of new row)
            this.guesses.push(this.letters.join(''))

            // SAVE PROGRESS (Only for Daily Challenge)
            if (this.dailyChallenge && this.user) {
                this.saveDailyProgress();
            }

            // CHECK: winner? (Delayed notification to match visual)
            if (this.correctLetters == this.wordLength) {
                // Wait for animation to finish before showing modal
                setTimeout(() => {
                    this.$nextTick(() => this.gameWon())
                    this.playSound('win');
                    this.triggerHaptic('win');
                }, 1200);
            }
            // CHECK: game over? (max # of guesses reached?)
            else if (this.numGuesses == this.totalGuesses) {
                setTimeout(() => {
                    this.$nextTick(() => this.gameLost())
                    this.playSound('loss');
                    this.triggerHaptic('loss');
                }, 1200);
            }

            setTimeout(() => {
                // Reset Active Row (after animation completes)
                this.boxStatus = [] // clear colors
                for (let i = 0; i < this.wordLength; i++) {
                    this.letters[i] = ''
                    this.boxStatus[i] = ''
                }
                this.cursor = 0 // reset cursor
                this.isClearing = false // remove fade class

            }, 900); // Wait for fade animation (match CSS duration)

        }, 1000); // 1s delay before moving

    },
    howManyInAnswer(l) {
        return (this.answer.split('')).filter(a => a == l).length
    },
    howManyInGuess(l) {
        return this.letters.filter(g => g == l).length
    },
    letterClicked(l) {
        // do nothing if no letter is passed, or modal is active
        if (!l || this.showNewGameModal) return
        // or max letters reached...
        if (this.cursor > this.wordLength - 1) return
        // or if game is over, do nothing
        if (this.isWinner || this.isLoser) return

        this.startTimer();


        // cursor at beginning? clear all other letters & box statuses (colors)
        if (this.cursor == 0) {
            for (let i = 0; i < this.wordLength; i++) {
                this.letters[i] = ''
            }
            this.boxStatus = []
        }

        // add letter to letters[] array
        this.letters[this.cursor] = l
        this.playSound('click');

        // if cursor > word length, and word is valid (in answersN[] array), ready to check
        if ((this.cursor == this.wordLength - 1) && (this.validWordList.includes(this.guess))) this.isReadyToCheck = true

        // advance cursor
        this.cursor++
    },
    enter() {
        // if guess is not ready, or game is over, do nothing
        if (!this.isReadyToCheck) return
        if (this.isWinner || this.isLoser) return

        // Prevent duplicates
        if (this.guesses.includes(this.guess.toUpperCase())) {
            this.playSound('backspace');
            this.showMessage("Already guessed!");
            return;
        }

        this.playSound('enter');
        this.evaluateGuess()
    },
    showMessage(msg, duration = 2000) {
        this.toastMessage = msg;
        this.showToast = true;
        this.triggerHaptic('invalid');
        setTimeout(() => { this.showToast = false }, duration);
    },
    backspace() {
        // if game is over, do nothing
        if (this.isWinner || this.isLoser) return

        // erase letter & decrement cursor
        this.letters[this.cursor - 1] = ''
        this.cursor--
        if (this.cursor < 0) this.cursor = 0
        this.playSound('backspace');

        // if erasing a letter, guess is no longer ready to check
        this.isReadyToCheck = false
    },
    gameWon() {
        this.stopTimer();
        // window.alert('You got it in ' + this.numGuesses + ((this.numGuesses < this.wordLength) ? '!' : '.') + ' Congrats!\n\nThe answer was: ' + this.answer)
        this.isWinner = true
        this.logStats()
        this.confettiWin() // Fire confetti!
        this.updateMusicState(); // Stop music
        this.showShareModal = true

    },
    confettiWin() {
        const duration = 3 * 1000;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now();

            if (timeLeft <= 0) {
                return clearInterval(interval);
            }

            const particleCount = 50 * (timeLeft / duration);
            // since particles fall down, start a bit higher than random
            let colors = (this.fireLevel >= 1) ? ['#fcd34d', '#f59e0b', '#ef4444'] : ['#26ccff', '#a25afd', '#ff5e7e', '#88ff5a', '#fcff42', '#ffa62d', '#ff36ff'];
            // If fire level is max (30+), add some "smoke" or intense colors? 
            // Stick to fire palette but maybe more intensity.

            confetti(Object.assign({}, defaults, { particleCount, colors, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
            confetti(Object.assign({}, defaults, { particleCount, colors, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
        }, 250);
    },
    gameLost() {
        // window.alert('Sorry, the answer was: ' + this.answer + '\n\nTry again!')
        this.stopTimer();
        this.isLoser = true
        this.logStats()
        this.updateMusicState(); // Stop music
        this.showShareModal = true

    },
    async shareGame(asImage = false) {
        // build full shareBlurb
        // Configurable APP_NAME / URL
        const appName = import.meta.env.VITE_APP_NAME || 'WordLetta';
        const appUrl = import.meta.env.VITE_APP_URL || 'wordletta.com'; // fallback to partial match if env missing

        // Date format: "Jan 6"
        const dateOptions = { month: 'short', day: 'numeric' };
        const shortDate = new Date().toLocaleDateString('en-US', dateOptions);

        let title = (this.dailyChallenge) ? `Daily Challenge ${shortDate}` : `Random ${this.wordLength}-Letter Game`

        // Random Phrase
        const phrase = this.sharePhrases[Math.floor(Math.random() * this.sharePhrases.length)];

        let blurb = `${appName} | ${title} | ${phrase}\n`
            + (this.isWinner ? '✔️' : '❌') + ' ' + this.numGuesses + '/6\n'
            + this.shareBlurb
            + `\nVisit ${appUrl} to play!`;

        if (asImage) {
            try {
                const blob = await this.generateResultImage(title, this.isWinner ? 'WON' : 'LOST', this.numGuesses + '/6', appUrl);
                const file = new File([blob], 'wordletta-result.png', { type: 'image/png' });
                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                    await navigator.share({
                        files: [file],
                        title: 'WordLetta Result',
                        text: blurb
                    });
                    return;
                }
            } catch (e) {
                console.error("Image sharing failed", e);
                // fall through to text share
            }
        }

        // copy share copy to clipboard
        clipboard.writeText(blurb).then(
            () => {
                // console.log("success!"); 
                this.$refs.shareButton.innerText = "Copied!"
                setTimeout(() => { this.$refs.shareButton.innerText = "Share Score" }, 2000);
            },
            () => { console.log("error!"); }
        );

        // launch browser share sheet (text only fallback)
        if (navigator.share && !asImage) {  // https://stackoverflow.com/a/55218902/5701
            navigator.share({
                title: appName,
                text: phrase,
                url: appUrl,
            }).then(() => {
                // console.log('Shared successfully.')
            }).catch((error) => {
                console.log('Error sharing', error)
            });
        }
    },
    generateResultImage(title, status, score, url = 'wordletta.com') {
        return new Promise((resolve) => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const pixelRatio = window.devicePixelRatio || 1;
            // set dimensions
            const width = 600;
            // height depends on grid size, let's estimate
            // header: 100, grid: ~400, footer: 50
            const rows = this.guesses.length;
            const height = 200 + (rows * 60);

            canvas.width = width;
            canvas.height = height;

            // Background
            ctx.fillStyle = '#f8fafc'; // slate-50
            ctx.fillRect(0, 0, width, height);

            // Header
            ctx.font = 'bold 40px Ramabhadra';
            ctx.fillStyle = '#1e293b'; // slate-800
            ctx.textAlign = 'center';
            ctx.fillText('WORDLETTA', width / 2, 60);

            ctx.font = '20px Lato';
            ctx.fillStyle = '#64748b'; // slate-500
            ctx.fillText(title, width / 2, 95);

            // Score/Status
            ctx.font = 'bold 30px Lato';
            ctx.fillStyle = (this.isWinner) ? '#10b981' : '#f43f5e'; // emerald-500 : rose-500
            ctx.fillText(status + ' ' + score, width / 2, 140);

            // Draw Grid
            const startY = 170;
            const boxSize = 50;
            const gap = 10;
            const totalRowWidth = (this.wordLength * boxSize) + ((this.wordLength - 1) * gap);
            const startX = (width - totalRowWidth) / 2;

            this.guessStatus.forEach((row, rowIndex) => {
                const y = startY + (rowIndex * (boxSize + gap));
                const colors = row.split(''); // 0,1,2
                colors.forEach((colorCode, colIndex) => {
                    const x = startX + (colIndex * (boxSize + gap));

                    // color map matches current CSS themes
                    let color = '#e2e8f0'; // slate-200 (gray)
                    if (colorCode == '1') color = '#fcd34d'; // amber-300 (yellow)
                    if (colorCode == '2') color = '#10b981'; // emerald-500 (green)

                    ctx.fillStyle = color;
                    // rounded rect?
                    ctx.fillRect(x, y, boxSize, boxSize);

                    // optional: border
                    // ctx.strokeStyle = 'rgba(0,0,0,0.1)';
                    // ctx.strokeRect(x,y,boxSize,boxSize);
                });
            });

            // Footer
            ctx.font = '16px Lato';
            ctx.fillStyle = '#94a3b8'; // slate-400
            ctx.fillText(url, width / 2, height - 20);

            canvas.toBlob((blob) => {
                resolve(blob);
            }, 'image/png');
        });
    },
    async logStats() {
        const duration = this.startTime ? Math.round((new Date() - this.startTime) / 1000) : 0;
        let statsObj = {
            "timestamp": new Date().toISOString(),
            "isWinner": this.isWinner,
            "numGuesses": this.numGuesses,
            "wordLength": this.wordLength,
            "hardMode": this.hardMode,
            "answer": this.answer,
            "guesses": this.guesses,
            "duration": duration
        }
        if (this.dailyChallenge) {
            statsObj.dailyChallengeDay = this.dailyChallengeDay
            this.dailyStats[this.dailyChallengeDay] = statsObj
            this.dailyChallengeComplete = true
        }
        this.endlessStats.push(statsObj)

        if (this.user) {
            try {
                const userRef = doc(db, "users", this.user.uid);
                await updateDoc(userRef, {
                    history: arrayUnion(statsObj),
                    settings: this.settings
                });
            } catch (e) {
                console.error("Error syncing stats", e);
            }
        }
    },
    async login() {
        const provider = new GoogleAuthProvider();
        try {
            const result = await signInWithPopup(auth, provider);
            this.user = result.user;
            // console.log("Logged in", this.user);
            await this.syncStats();
        } catch (error) {
            console.error("Login failed", error);
        }
    },
    logout() {
        signOut(auth).then(() => {
            this.user = null;
            this.endlessStats = []; // clear stats on logout? or keep local? 
            // for strict privacy, clear. for UX, maybe keep. Let's clear to show distinct states.
        });
    },
    async saveDailyProgress() {
        if (!this.user) return;
        try {
            const userRef = doc(db, "users", this.user.uid);
            await updateDoc(userRef, {
                dailyProgress: {
                    day: this.dailyChallengeDay,
                    guesses: this.guesses,
                    gameTime: this.gameTime,
                    timestamp: new Date().toISOString()
                }
            });
        } catch (e) {
            console.error("Error saving daily progress", e);
        }
    },
    async syncStats() {
        if (!this.user || !db) return;
        const userRef = doc(db, "users", this.user.uid);
        const docSnap = await getDoc(userRef);

        if (docSnap.exists()) {
            // Load cloud stats
            const data = docSnap.data();
            this.endlessStats = data.history || [];
            if (data.settings) {
                this.settings = { ...this.settings, ...data.settings };
                // Apply theme if loaded
                if (this.settings.theme) this.updateBodyClass();
            }

            // Sync Daily Challenge Status (Remote -> Local)
            const todayIndex = this.dailyChallengeDay;
            // 1. Check for games explicitly tagged (Newer version games)
            let dailyWin = this.endlessStats.find(g => g.dailyChallengeDay === todayIndex && g.isWinner);

            // 2. Fallback: Check for legacy games (match by word content)
            if (!dailyWin) {
                try {
                    const response = await fetch('./words/daily-challenge.js');
                    const dailyWords = await response.json();
                    const todaysWord = dailyWords[todayIndex];
                    if (todaysWord) {
                        dailyWin = this.endlessStats.find(g => g.answer === todaysWord.toUpperCase() && g.isWinner);
                        if (dailyWin) {
                            // Backfill the tag locally for consistency
                            dailyWin.dailyChallengeDay = todayIndex;
                        }
                    }
                } catch (e) {
                    console.error("Error verifying daily challenge legacy status", e);
                }
            }

            if (dailyWin) {
                this.dailyChallengeComplete = true;
                this.dailyStats[todayIndex] = dailyWin;
            } else if (data.dailyProgress && data.dailyProgress.day === todayIndex && !this.dailyChallengeComplete) {
                // Restore In-Progress Daily Challenge - DEFERRED
                // We do NOT restore it automatically. We just flag it.
                console.log("Found in-progress Daily Challenge. Deferring restore.");
                this.dailyChallengeInProgress = true;
                // this.dailyChallenge = true; <-- WAS CAUSING BUG
                // this.showNewGameModal = false; <-- WAS CAUSING BUG

                // Restore Timer
                this.gameTime = data.dailyProgress.gameTime || 0;

                // CRITICAL: Force fetch daily words to ensure answer key is correct
                // (Even if wordList is length > 0, it might be the random list)
                try {
                    let response = await fetch('./words/daily-challenge.js');
                    this.wordList = await response.json();
                    this.wordLength = 6;
                    this.hardMode = false;
                } catch (e) { console.error("Error fetching daily words for restore", e); }

                if (this.wordList[todayIndex]) {
                    this.answer = this.wordList[todayIndex].toUpperCase();
                }

                // Restore Guesses
                const savedGuesses = data.dailyProgress.guesses || [];
                this.guesses = [];
                // Reset statuses to ensure clean slate for coloring
                this.guessStatus = [];
                // We should probably reset alphabetStatus too, but if they played before...
                // Safest to rebuild it from the guesses.
                this.alphabetStatus = new Array(this.alphabet.length).fill('');

                savedGuesses.forEach(g => {
                    this.guesses.push(g);
                    // Re-calculate local state (colors)
                    // logic simplified from evaluateGuess for restoration
                    let answerClone = this.answer.split('');
                    let currentBoxStatus = new Array(6).fill(0);
                    let letters = g.split('');

                    // 1. Exact matches
                    letters.forEach((l, i) => {
                        if (l === answerClone[i]) {
                            this.alphabetStatus[this.alphabet.indexOf(l)] = 2;
                            currentBoxStatus[i] = 2;
                            answerClone[i] = null;
                        }
                    });
                    // 2. Partial matches
                    letters.forEach((l, i) => {
                        if (l && answerClone.includes(l)) {
                            if (this.alphabetStatus[this.alphabet.indexOf(l)] !== 2) this.alphabetStatus[this.alphabet.indexOf(l)] = 1;
                            if (!currentBoxStatus[i]) currentBoxStatus[i] = 1;
                            answerClone[answerClone.indexOf(l)] = null;
                        } else if (l) {
                            if (this.alphabetStatus[this.alphabet.indexOf(l)] === '') this.alphabetStatus[this.alphabet.indexOf(l)] = 0;
                        }
                    });
                    this.guessStatus.push(currentBoxStatus.join(''));
                });

                this.showMessage("Daily Challenge Restored", 3000);
            }
        } else {
            // New user doc
            await setDoc(userRef, {
                email: this.user.email,
                history: this.endlessStats,
                settings: this.settings
            });
        }
    },
    setTheme(themeName) {
        this.settings.theme = themeName;
        this.updateBodyClass();
        this.saveData();
    },
    updateBodyClass() {
        // Don't overwrite className completely! Just toggle theme classes on body.
        document.body.classList.remove('dark', 'contrast');
        if (this.settings.theme === 'dark') document.body.classList.add('dark');
        if (this.settings.theme === 'contrast') document.body.classList.add('contrast');
    },
    // Timer Methods
    startTimer() {
        if (this.timerStarted || this.isWinner || this.isLoser) return;
        this.timerStarted = true;
        this.gameTime = 0;
        this.timerInterval = setInterval(() => {
            if (!this.isPaused) {
                this.gameTime += 0.1;
            }
        }, 100);
        this.resetIdleTimer();
    },
    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.idleTimeout) {
            clearTimeout(this.idleTimeout);
            this.idleTimeout = null;
        }
    },
    togglePause() {
        if (!this.timerStarted || this.isWinner || this.isLoser) return;
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            if (this.idleTimeout) clearTimeout(this.idleTimeout);
        } else {
            this.resetIdleTimer();
        }
        this.updateMusicState(); // Pause/Resume music
    },

    get formattedTime() {
        return this.gameTime.toFixed(1) + 's';
    },
    get headerTime() {
        const totalSeconds = Math.floor(this.gameTime);
        const m = Math.floor(totalSeconds / 60);
        const s = totalSeconds % 60;
        // Show m:ss (e.g. 0:01, 1:05)
        return `${m}:${s.toString().padStart(2, '0')}`;
    },

    resetStats() {
        this.endlessStats = []
        this.dailyStats = []
        this.dailyChallengeComplete = false
    },
    // loadLocalSettings removed (duplicate). logic moved to loadData
    // ...
    loadData() {
        const local = localStorage.getItem('wordletta_settings');
        if (local) {
            try {
                const parsed = JSON.parse(local);
                this.settings = { ...this.settings, ...parsed };
                if (this.settings.theme) this.updateBodyClass();
            } catch (e) {
                console.error('Error loading settings', e);
            }
        }
        // Ensure keyboard layout is valid
        if (!this.settings.keyboardLayout || !LAYER_DEFS[this.settings.keyboardLayout]) {
            this.settings.keyboardLayout = 'QWERTY';
        }
        this.setKeyboardLayout(this.settings.keyboardLayout, false);
    },
    async saveData() {
        // Consolidated save function
        if (this.user) {
            try {
                const userRef = doc(db, "users", this.user.uid);
                await updateDoc(userRef, {
                    settings: this.settings
                });
            } catch (e) {
                console.error("Error saving settings", e);
            }
        } else {
            localStorage.setItem('wordletta_settings', JSON.stringify(this.settings));
        }
    },
    toggleSound() {
        this.settings.sound = !this.settings.sound;
        this.saveData();
    },
    toggleMusic() {
        this.settings.music = !this.settings.music;
        this.saveData();
        this.updateMusicState();
    },

    toggleHaptics() {
        this.settings.haptics = !this.settings.haptics;
        if (this.settings.haptics) this.triggerHaptic('enter'); // feedback
        this.saveData();
    },
    setKeyboardLayout(layoutName, save = true) {
        if (!LAYER_DEFS[layoutName]) return;

        const oldAlphabet = [...this.alphabet];
        const oldStatus = [...this.alphabetStatus];

        // Map status to letter
        let statusMap = {};
        oldAlphabet.forEach((letter, index) => {
            statusMap[letter] = oldStatus[index];
        });

        // Set New Layout
        this.settings.keyboardLayout = layoutName;
        this.keyboardRows = LAYER_DEFS[layoutName];
        this.alphabet = this.keyboardRows.flat();

        // Rebuild Status Array in new order
        // Rebuild Status Array in new order
        this.alphabetStatus = this.alphabet.map(letter => {
            // Fix 0 being treated as falsey
            const val = statusMap[letter];
            return (val !== undefined) ? val : '';
        });

        console.log('Layout:', layoutName); // DEBUG
        console.log('Alphabet:', JSON.stringify(this.alphabet)); // DEBUG
        console.log('Status Map:', JSON.stringify(statusMap)); // DEBUG
        console.log('New Status:', JSON.stringify(this.alphabetStatus)); // DEBUG

        if (save) this.saveData();
    },

    // Audio Context Singleton
    audioCtx: null,

    initAudio() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }
        if (this.audioCtx && this.audioCtx.state === 'suspended') {
            this.audioCtx.resume();
        }
    },

    playSound(type) {
        if (!this.settings.sound) return;
        this.initAudio();
        if (!this.audioCtx) return;

        const now = this.audioCtx.currentTime;

        // Mechanical Switch Simulation (Click + Thock)
        const createClick = (time, freq = 1500, vol = 0.1) => {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.frequency.setValueAtTime(freq, time);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.5, time + 0.05);
            gain.gain.setValueAtTime(vol, time);
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);
            osc.start(time);
            osc.stop(time + 0.05);
        };

        const createThock = (time, freq = 200, vol = 0.3) => {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.type = 'sine'; // softer than triangle
            osc.frequency.setValueAtTime(freq, time);
            osc.frequency.exponentialRampToValueAtTime(50, time + 0.1);
            gain.gain.setValueAtTime(vol * 0.6, time); // reduced volume
            gain.gain.exponentialRampToValueAtTime(0.01, time + 0.1);
            osc.start(time);
            osc.stop(time + 0.1);
        };

        // Reuse simple osc for legacy effects compatibility (just in case)
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        if (type === 'click') {
            // Standard Key: High click + Low thud
            createClick(now, 1500, 0.05);
            createThock(now, 200, 0.2);
        } else if (type === 'enter') {
            // Stabilized Key: Lower thud, slightly louder
            createClick(now, 1200, 0.05);
            createThock(now, 150, 0.3);
        } else if (type === 'backspace') {
            // Subtle tick / paper-ish sound
            osc.frequency.setValueAtTime(800, now);
            osc.type = 'triangle'; // softer than sawtooth
            // Filter noise-like effect? Synth is simple, let's just do a short high pitch chirp
            // Or actually, let's use a quick noise burst if we could, but osc is easier.
            // Let's do a quick pitch drop "pew" but very short and quiet
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);

            gainNode.gain.setValueAtTime(0.1, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.03); // very short
            osc.start(now);
            osc.stop(now + 0.03);
        } else if (type === 'match') {
            // Nice ding
            osc.frequency.setValueAtTime(800, now);
            osc.type = 'sine';
            gainNode.gain.setValueAtTime(0.2, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.3);
        } else if (type === 'win') {
            // Little fanfare
            // TrumpetScript: Bah buh-buh BAH buh Buh BAAAAAH!!
            this.playNote(523.25, 0.0, 0.15); // C5 (Bah)
            this.playNote(392.00, 0.20, 0.10); // G4 (buh)
            this.playNote(392.00, 0.35, 0.10); // G4 (buh)
            this.playNote(523.25, 0.50, 0.25); // C5 (BAH)
            this.playNote(659.25, 0.80, 0.15); // E5 (buh)
            this.playNote(783.99, 1.00, 0.15); // G5 (Buh)
            this.playNote(1046.50, 1.20, 0.80); // C6 (BAAAAAH!!)
        } else if (type === 'loss') {
            // Sad thud
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.exponentialRampToValueAtTime(50, now + 0.5);
            osc.type = 'triangle';
            gainNode.gain.setValueAtTime(0.3, now);
            gainNode.gain.linearRampToValueAtTime(0, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.5);
        }

        // Haptic Feedback Trigger (Sync with sound)
        this.triggerHaptic(type);
    },

    triggerHaptic(type) {
        // Check for support & settings
        if (!navigator.vibrate || !this.settings.haptics) return;

        switch (type) {
            case 'click':
                navigator.vibrate(5); // Ultra short tick
                break;
            case 'enter':
                navigator.vibrate(10); // Slightly stronger
                break;
            case 'backspace':
                navigator.vibrate(5);
                break;
            case 'match': // row evaluation match
                navigator.vibrate(2);
                break;
            case 'win':
                navigator.vibrate([50, 50, 50, 50, 100]); // Pulse
                break;
            case 'loss':
                navigator.vibrate([100, 50, 100]); // Double thud
                break;
            case 'invalid':
                navigator.vibrate(20);
                break;
        }
    },

    playNote(freq, delay, duration) {
        if (!this.settings.sound || !this.audioCtx) return;
        const osc = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        const now = this.audioCtx.currentTime + delay;
        osc.frequency.value = freq;
        osc.type = 'triangle';

        gainNode.gain.setValueAtTime(0.1, now);
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration);

        osc.start(now);
        osc.stop(now + duration);
    },

    // DEBUG TOOLS
    debugSimulateStreak(days = 7) {
        // Reset valid stats for clean slate debug
        this.dailyStats = [];

        const todayIndex = this.dailyChallengeDay;

        for (let i = 0; i < days; i++) {
            let dayIndex = todayIndex - i;
            if (dayIndex >= 0) {
                this.dailyStats[dayIndex] = {
                    "timestamp": new Date().toISOString(), // fake timestamp
                    "isWinner": true,
                    "numGuesses": Math.floor(Math.random() * 6) + 1,
                    "wordLength": 6,
                    "hardMode": false,
                    "answer": "DEBUG",
                    "guesses": ["DEBUG"],
                    "duration": 60
                }
            }
        }

        // Setup state for "Win" screen
        this.dailyChallengeComplete = true;
        this.isWinner = true; // force win state for modal styling
        // this.numGuesses is a getter, so we need to fake the guesses array
        this.guesses = ['DEBUG1', 'DEBUG2', 'WINNER'];
        this.kudos[3] = "Simulated Win!";

        this.showMessage(`Simulated ${days} Day Streak! 🔥`, 3000);

        // Show Win Screen & Confetti
        this.showSettingsModal = false;
        // Delay slightly for modal transition
        setTimeout(() => {
            this.showShareModal = true;
            this.confettiWin();
            this.showShareModal = true;
            this.confettiWin();
        }, 1000); // Delayed slightly more for visual effect
    },
    async debugSimulateDailyInProgress() {
        if (!this.user) {
            this.showMessage("Please log in to mock cloud save.");
            return;
        }
        console.log("Mocking Daily In Progress...");

        // 1. Save a partial game to Firestore
        const userRef = doc(db, "users", this.user.uid);
        await updateDoc(userRef, {
            dailyProgress: {
                day: this.dailyChallengeDay,
                guesses: ["DEBUG", "START"], // Mock 2 guesses
                gameTime: 123.4,
                timestamp: new Date().toISOString()
            }
        });

        // 2. Clear local stats to simulate a 'fresh' load
        this.dailyChallenge = false;
        this.dailyChallengeInProgress = false;
        this.dailyChallengeComplete = false;
        this.guesses = [];
        this.gameTime = 0;

        // 3. Trigger syncStats to "discover" it
        await this.syncStats();

        this.showMessage("Mocked! Check Daily Challenge UI.", 3000);
    },

    // Background Music Methods
    initMusic() {
        if (!this.bgMusic) {
            this.bgMusic = new Audio('/audio/wordletta-bg-salsangrahop.wav');
            this.bgMusic.loop = true;
            this.bgMusic.volume = this.settings.musicVolume || 0.3;
        }
    },

    // Core volume setter - handles both Logic and Persistence if needed
    setMusicVolume(val) {
        let newVol = parseFloat(val);
        // Clamp between 0 and 1
        newVol = Math.max(0, Math.min(1, newVol));

        this.settings.musicVolume = newVol;

        // Logic: Volume > 0 means 'Music On'. Volume 0 means 'Music Off'
        if (newVol > 0) {
            this.settings.music = true;
            // Only update memory if we are NOT securely tweening (manual drag)
            if (!this.isTweening) {
                this.settings.lastVolume = newVol;
            }
        } else {
            this.settings.music = false;
        }

        if (this.bgMusic) {
            this.bgMusic.volume = this.settings.musicVolume;
        }

        this.updateMusicState();
    },

    // Called by toggle button (or mute button)
    toggleMusic() {
        const duration = 400; // ms
        const steps = 20;
        const intervalTime = duration / steps;

        let startVol = this.settings.musicVolume;
        let targetVol = 0;

        // Lock volume memory updates during tween
        this.isTweening = true;

        // If currently on (vol > 0), target is 0.
        // If currently off (vol == 0), target is lastVolume.
        if (this.settings.music && this.settings.musicVolume > 0) {
            this.settings.lastVolume = this.settings.musicVolume;
            targetVol = 0;
        } else {
            targetVol = this.settings.lastVolume > 0 ? this.settings.lastVolume : 0.3;
            // Ensure music state is on so it actually plays during fade in
            this.settings.music = true;
        }

        const volDiff = targetVol - startVol;
        let currentStep = 0;

        // Clear any existing interval to prevent fighting
        if (this._volInterval) clearInterval(this._volInterval);

        this._volInterval = setInterval(() => {
            currentStep++;
            // Ease out cubic
            const progress = currentStep / steps;
            const ease = 1 - Math.pow(1 - progress, 3);

            let newVol = startVol + (volDiff * ease);

            // Clamp
            if (currentStep === steps) {
                newVol = targetVol;
                clearInterval(this._volInterval);
                this.isTweening = false; // Unlock

                // Final state update
                if (targetVol === 0) {
                    this.settings.music = false;
                }
                this.setMusicVolume(newVol);
                this.persistVolume();
            } else {
                this.setMusicVolume(newVol);
            }

        }, intervalTime);
    },

    persistVolume() {
        this.saveData();
    },
    updateMusicState() {

        if (!this.bgMusic) this.initMusic();

        // Music plays if:
        // 1. Enabled in Settings
        // 2. Not Paused (user or modal)
        // 3. Game in progress (Not Winner, Not Loser)
        // 4. Initial Modal Closed (Game 'Started')
        const shouldPlay = this.settings.music
            && !this.isPaused
            && !this.isWinner
            && !this.isLoser
            && !this.showNewGameModal
            && !this.showHelpModal;

        if (shouldPlay) {
            // Only play if not already playing to avoid errors/restarts
            if (this.bgMusic.paused) {
                this.bgMusic.play().catch(e => {
                    // console.warn("Auto-play blocked, waiting for interaction", e);
                });
            }
        } else {
            if (!this.bgMusic.paused) {
                this.bgMusic.pause();
            }
        }
    }

})

