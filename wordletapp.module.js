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

const TRACKS = [
    { name: 'Salsangra', file: 'wordletta-bg-salsangrahop.wav' },
    { name: 'Chill Sham', file: 'wordletta-chill-sham.wav' },
    { name: 'Dirty Dreamy', file: 'wordletta-dirty-dreamy.wav' }
];

// Alpine.data('wordletApp', () => ({
export default () => ({
    title: 'WordLetta',
    version: '2.2.1',
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
    pausedByModal: false,
    showPauseMenu: false, // UI Overlay state
    wasPauseMenuOpen: false, // State memory

    // Hints State
    hintsUsed: 0,
    maxHints: 3,
    showHintsModal: false,
    hintActiveIndex: -1, // For animating specific boxes

    // Animation States
    showBombAnimation: false,
    bombFloatingKeys: [], // {char, x, y, w, h}
    bombStage: 0, // 0: init, 1: fly, 2: explode
    highlightKey: '', // char to pulse highlight

    // Green Light Overlay State
    showGreenLightAnimation: false,
    greenLightFloatingKey: { char: '', x: 0, y: 0, w: 0, h: 0, fontSize: '1rem' },
    greenLightStage: 0, // 0: init (yellow), 1: hold, 2: move & green

    // Buy Vowel Overlay State
    showVowelAnimation: false,
    vowelFloatingKey: { char: '', x: 0, y: 0, w: 0, h: 0, fontSize: '1rem', colorClass: 'bg-slate-200 text-slate-700' },
    vowelStage: 0, // 0: Center Gray, 1: Center Yellow, 2: Move to Keyboard

    // PWA State

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
        keyboardLayout: 'QWERTY',
        musicTrack: 'wordletta-dirty-dreamy.wav'
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
    statsTab: 'endless',
    tracks: TRACKS,


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
        const modalWatcher = (value) => {
            this.checkModalPauseState();
        };

        this.$watch('showSettingsModal', modalWatcher);
        this.$watch('showHelpModal', (value) => {
            this.checkModalPauseState();
            this.updateMusicState();
        });
        this.$watch('showReleaseNotesModal', modalWatcher);
        this.$watch('showStatsModal', modalWatcher);
        this.$watch('showHintsModal', modalWatcher);
        this.$watch('showNewGameModal', (value) => {
            this.checkModalPauseState();
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

    checkModalPauseState() {
        if (this.isAnyModalOpen) {
            // OPENING:
            // 1. Hide the Pause Menu if it's open (so we can see the modal)
            if (this.showPauseMenu) {
                this.wasPauseMenuOpen = true;
                this.showPauseMenu = false;
            }
            // 2. Pause the game if it's running
            if (this.timerStarted && !this.isPaused && !this.isWinner && !this.isLoser) {
                this.setPause(true);
                this.pausedByModal = true;
            }
        } else {
            // CLOSING:
            // 1. Resume game if WE paused it
            if (this.timerStarted && this.isPaused && !this.isWinner && !this.isLoser && this.pausedByModal) {
                this.setPause(false);
                this.pausedByModal = false;
            }
            // 2. Restore Pause Menu if it was open (and game is still paused/manual)
            // Note: If we just resumed (above), isPaused is false, so menu shouldn't show.
            // This really only applies if we DIDN'T resume (because it was manually paused).
            if (this.wasPauseMenuOpen && this.isPaused) {
                this.showPauseMenu = true;
                this.wasPauseMenuOpen = false;
            }
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
    releaseNotes: [
        {
            version: '2.2.0',
            date: 'Jan 17, 2026',
            title: 'Polished & Tuned 🎵✨',
            features: [
                '🎵 **Audio feedback:** Hearing things? Settings now ping!',
                '🧊 **Glassy UI:** Music overlay got a frosty makeover.',
                '📊 **Stats Icon:** Better visibility in the footer.',
                '🐛 **Bug Fixes:** Overlay z-index & various tweaks.'
            ]
        },
        {
            version: '2.1.0',
            date: 'Jan 15, 2026',
            title: 'Pronounce & Polish 🗣️✨',
            features: [
                '🗣️ **Pronounce:** Not sure how to say it? Tap the new Talk icon on the Game Over screen!',
                '📖 **Define:** Definition lookup is now smoother and integrated.',
                '🚦 **Green Light Fix:** Cursor now smartly jumps over revealed letters.',
                '⏸️ **Pause Timer:** Now shows clean mm:ss format.',
                '🎨 **UI Polish:** High Contrast icon visibility fixes & better bold text.',
                '⚙️ **Settings:** Layouts reordered & active states animated.'
            ]
        },
        {
            version: '2.0.0',
            date: 'Jan 13, 2026',
            title: 'Hints & Hype Update! 💡✨',
            features: [
                'NEW: Hints System Overhaul! Used a hint? Get ready for a show.',
                'Green Light!: New animation slides letters into place.',
                'Buy a Vowel: Watch vowels fly from the ether to your keyboard.',
                'Letta Bomb: Unneeded letters explode with more pizazz.',
                'Visuals: "Ghost" styling for ruled-out letters in the active row.',
                'Start Fresh: Smoother animations and cleaner UI throughout.',
                'Fixed: Various bugs squashed for a buttery smooth experience.'
            ]
        },
        {
            version: '1.9.3',
            date: 'Jan 12, 2026',
            title: 'Weekly View Update',
            features: [
                'Refined key UI interactions'
            ]
        }
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
        // displayedStats is the source of truth now
        const source = this.displayedStats;
        if (!source) return [0, 0, 0, 0, 0, 0]
        let dist = [0, 0, 0, 0, 0, 0]
        source.filter(g => g.isWinner).forEach(g => {
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
    get displayedStats() {
        if (!this.endlessStats) return [];
        if (this.statsTab === 'daily') {
            return this.endlessStats.filter(g => g.dailyChallengeDay !== undefined);
        } else {
            return this.endlessStats.filter(g => g.dailyChallengeDay === undefined);
        }
    },
    get recentHistory() {
        return this.displayedStats.slice().reverse().slice(0, 50)
    },
    get userGames() { return this.displayedStats.length },
    get userWins() { return this.displayedStats.filter(g => g.isWinner).length },
    get userLosses() { return this.displayedStats.filter(g => !g.isWinner).length },
    get userWinPct() { return (this.userGames > 0) ? Math.round((this.userWins / this.userGames) * 100) : 0 },
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
    get hasYellowLetters() {
        // Check if any letter in alphabetStatus is 1 (Yellow)
        // OR check boxStatus of current row? 
        // Actually, we want to know if the USER has found any yellow letters in previous guesses.
        return this.alphabetStatus.some(s => s == 1);
    },
    get allVowelsFound() {
        const vowels = ['A', 'E', 'I', 'O', 'U'];
        // check if all vowels THAT ARE IN THE ANSWER have been found (status 1 or 2).
        // If a vowel is NOT in the answer, we don't care if it's found or not for this check? 
        // "If the user has guessed all vowels in the hidden word"
        if (!this.answer) return false;
        const answerVowels = vowels.filter(v => this.answer.includes(v));
        if (answerVowels.length === 0) return true; // No vowels in word (rare)

        // specific check: are all answerVowels either green (2) or yellow (1) in alphabetStatus?
        return answerVowels.every(v => {
            const idx = this.alphabet.indexOf(v);
            return this.alphabetStatus[idx] == 1 || this.alphabetStatus[idx] == 2;
        });
    },
    async fetchWordList(num, level = '') {
        if (!num) return false
        // NOTE: ensure a non-hardMode /words/*.js file exists
        if (num > 6) this.hardMode = true
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

        // Save progress on page hide/unload
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                if (this.dailyChallenge && this.timerStarted) {
                    this.updateTimer(); // Ensure latest second is captured
                    this.saveDailyProgress();
                }
            }
        });
        window.addEventListener('beforeunload', () => {
            if (this.dailyChallenge && this.timerStarted) {
                this.updateTimer();
                // Best effort synchronous save attempt or beacon?
                // Firestore is async, so this might not complete. 
                // visibilitychange is more reliable on mobile.
                this.saveDailyProgress();
            }
        });

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
        this.hintsUsed = 0; // Reset hint usage
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
    // ...
    async restoreDailyGame() {
        console.log("Explicitly restoring Daily Challenge...");
        this.dailyChallenge = true;
        this.showNewGameModal = false;

        // Explicitly reset game-over state so input is not blocked
        this.isWinner = false;
        this.isLoser = false;
        this.isClearing = false;

        // Ensure user is logged in for the restore flow to work effectively 
        // (though we already checked this in syncStats to set the flag)

        // Re-run the restore logic that was previously in syncStats
        // Ideally we should have cached the data object, but we might need to re-fetch if we didn't save it.
        // Actually, 'data' is local to syncStats. 
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
    startEndlessGame() {
        this.dailyChallenge = false;
        this.newGame(true);
    },
    startDailyGame() {
        if (this.dailyChallengeInProgress) {
            this.restoreDailyGame();
        } else {
            this.dailyChallenge = true;
            this.newGame(true);
        }
    },
    viewDailyBoard() {
        const todayIndex = this.dailyChallengeDay;
        const dailyData = this.dailyStats[todayIndex];
        if (dailyData) {
            this.guesses = dailyData.guesses;
            this.answer = dailyData.answer;
            this.dailyChallenge = true;
            this.isWinner = dailyData.isWinner || true;
            this.gameTime = dailyData.duration || 0;
            // Force keyboard status update if needed, though watcher might handle it on guess change
            // But guesses are replaced, so we might need to trigger alphabet update manually?
            // Actually, letters/boxStatus might need update?
            // Let's rely on 'guesses' watcher if it exists, or call updateBoxStatus?
            // For now, minimal implementation which sets the state variables.
        }
        this.showNewGameModal = false;
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

    isLetterRuledOut(char) {
        if (!char) return false;
        // Ensure char is uppercase just in case
        const c = char.toUpperCase();
        const idx = this.alphabet.indexOf(c);
        // Status 0 (number) or '0' (string) means ruled out.
        // Empty string '' means unused.
        return idx !== -1 && (this.alphabetStatus[idx] === 0 || this.alphabetStatus[idx] === '0');
    },

    // --- HINTS LOGIC ---
    async hintLettaBomb() {
        if (this.hintsUsed >= this.maxHints) return;

        const candidateLetters = this.alphabet.filter((char, index) => {
            return !this.answer.includes(char) && this.alphabetStatus[index] === '';
        });

        if (candidateLetters.length === 0) {
            this.showMessage("No letters to bomb!");
            return;
        }

        // Pick 3 random
        const bombCount = Math.min(3, candidateLetters.length);
        const toBomb = [];
        for (let i = 0; i < bombCount; i++) {
            const r = Math.floor(Math.random() * candidateLetters.length);
            toBomb.push(candidateLetters[r]);
            candidateLetters.splice(r, 1);
        }

        this.showHintsModal = false;
        this.hintsUsed++;

        // 1. Capture positions
        this.bombFloatingKeys = [];
        this.bombStage = 0;
        this.showBombAnimation = true;

        // Wait for DOM to update and modal to close?
        await new Promise(r => setTimeout(r, 100));

        // Find elements
        // This is tricky in Alpine. We need refs or querySelector.
        // We'll use text content matching since we don't have unique IDs per key easily available.
        // Or we iterate keyboardRows in DOM.
        // Let's try querySelector with text.
        const keyEls = Array.from(document.querySelectorAll('.noselect'));

        toBomb.forEach(char => {
            const el = keyEls.find(e => e.innerText.trim() === char);
            if (el) {
                const rect = el.getBoundingClientRect();
                this.bombFloatingKeys.push({
                    char: char,
                    x: rect.left,
                    y: rect.top,
                    w: rect.width,
                    h: rect.height,
                    exploded: false
                });
            }
        });

        // 2. Trigger Fly to Center
        // We need a slight delay to allow rendering at initial position
        setTimeout(() => {
            this.bombStage = 1; // Class 'animate-fly-center' applies (transition)

            // Centered Layout Config
            const cx = window.innerWidth / 2;
            const cy = window.innerHeight / 2;
            const gap = 20; // px gap between tiles
            // Assume visual width scale is ~2. 
            // We want them side-by-side: [ 1 ] [ 2 ] [ 3 ]
            // Spacing = (BaseWidth * Scale) + Gap.
            // We can estimate base width from the first item or average.
            const baseW = this.bombFloatingKeys[0]?.w || 40;
            const spacing = (baseW * 2) + gap;

            // Calculate starting offset to center the group
            // For 3 items: -spacing, 0, +spacing
            // For N items: idx - (total-1)/2

            this.bombFloatingKeys.forEach((k, idx) => {
                const offsetFactor = idx - ((this.bombFloatingKeys.length - 1) / 2);
                k.x = cx + (offsetFactor * spacing) - (k.w / 2);
                k.y = cy - (k.h / 2);
            });

            this.playSound('click'); // Woosh sound?

        }, 50);

        // 3. Explode
        // Wait 1s for fly + 1s hold = 2s delay
        // 3. Explode Sequence
        // Fly = 1s, Hold = 800ms -> Start at 1850ms
        setTimeout(() => {
            // Staggered explosion
            this.bombFloatingKeys.forEach((item, index) => {
                setTimeout(() => {
                    item.exploded = true;
                    this.playSound('explosion');

                    // Turn key gray immediately
                    const idx = this.alphabet.indexOf(item.char);
                    if (idx !== -1) {
                        this.alphabetStatus[idx] = 0;
                    }
                }, index * 150); // 150ms stagger
            });

            // Cleanup
            // Wait for all explosions (e.g. 3 items = 300ms start + 500ms anim) + buffer
            const totalDuration = (this.bombFloatingKeys.length * 150) + 1000;
            setTimeout(() => {
                this.showBombAnimation = false;
                this.bombStage = 0;
                this.bombFloatingKeys = [];
                this.showMessage(`💣 BOOM! Removed ${toBomb.join(', ')}`);
            }, totalDuration);

        }, 1850);


    },

    async hintGreenLight() {
        if (this.hintsUsed >= this.maxHints) return;

        // Find candidates from previous guesses that were marked Yellow (1)
        // We look at `guessStatus` history.
        // Flatten all yellow instances? Or just look at most recent?
        // Let's gather ALL letters that were marked '1' in any previous guess
        // AND are technically not "solved" (well, Green Light moves them, so solved is irrelevant).
        // Actually, simpler: Just find ANY letter that appeared as Yellow in history.
        // Even better: Prioritize yellows from the *latest* guess.

        let candidates = [];
        // Iterate backwards through guesses to find the most recent yellows
        for (let i = this.guesses.length - 1; i >= 0; i--) {
            const rowWord = this.guesses[i];
            const rowStatus = this.guessStatus[i]; // String e.g. "01202"

            // Find indices where status is 1 (Yellow)
            const yellowIndices = rowStatus.split('').map((s, idx) => s == '1' ? idx : -1).filter(idx => idx !== -1);

            if (yellowIndices.length > 0) {
                // Convert indices to chars
                const rowCandidates = yellowIndices.map(idx => rowWord[idx]);
                candidates = [...new Set(rowCandidates)]; // Unique chars
                break; // Stop at the most recent row with yellows? Yes, best context.
            }
        }

        // Fallback: If no yellows in latest relevant row, try alphabetStatus?
        // Or if the user really has NO yellows ever?
        if (candidates.length === 0) {
            // Try global status as fallback
            candidates = this.alphabet.filter((l, i) => this.alphabetStatus[i] == 1);
        }

        if (candidates.length === 0) {
            this.showMessage("No yellow letters to fix!");
            return;
        }

        const targetChar = candidates[Math.floor(Math.random() * candidates.length)];
        const correctIndices = [];
        this.answer.split('').forEach((l, i) => { if (l === targetChar) correctIndices.push(i); });

        // Pick target index where this char belongs
        // Prefer one that isn't currently filled with the correct char?
        // (i.e. if user already has R correct in col 3, and we are fixing a yellow R, find another slot)
        let targetIndex = correctIndices.find(i => this.letters[i] !== targetChar);


        if (targetIndex === undefined) {
            // If all instances are already in correct spot in current guess?
            // Then maybe pick another candidate?
            // If impossible, just pick first one and animate it "staying put"?
            targetIndex = correctIndices[0];
        }

        if (targetIndex === undefined) { targetIndex = correctIndices[0]; }

        this.hintsUsed++;
        this.showHintsModal = false;

        // 1. Calculate Positions
        // Source: "Last known position" from recent history.
        // We find the most recent guess row that had this char on a YELLOW spot (1).
        // Actually, just find the char in the most recent row it appeared.
        let sourceCol = -1;
        // Search backwards [guesses.length-1 ... 0]
        // But wait, user said "appear in the active guess row, its last-known position".
        // This implies visual column index.
        const reversedHistory = this.guesses.slice().reverse();
        for (let g of reversedHistory) {
            if (g.includes(targetChar)) {
                sourceCol = g.indexOf(targetChar); // First occurrence
                break;
            }
        }
        if (sourceCol === -1) sourceCol = targetIndex; // Fallback

        // Find DOM Elements for Active Row
        // Selector: .row.guess .letter input
        // Since there is only one ".row.guess" (the input row), we can find it easily.
        await new Promise(r => setTimeout(r, 100)); // wait for modal close
        const inputBoxes = document.querySelectorAll('.row.guess .letter');

        if (!inputBoxes[sourceCol] || !inputBoxes[targetIndex]) return;

        const sourceRect = inputBoxes[sourceCol].getBoundingClientRect();
        const targetRect = inputBoxes[targetIndex].getBoundingClientRect();
        const computedStyle = window.getComputedStyle(inputBoxes[sourceCol].querySelector('input')); // Get font size

        // 2. Setup Animation Overlay
        this.greenLightFloatingKey = {
            char: targetChar,
            x: sourceRect.left,
            y: sourceRect.top,
            w: sourceRect.width,
            h: sourceRect.height,
            fontSize: computedStyle.fontSize
        };
        this.greenLightStage = 1; // Yellow, Start Pos
        this.showGreenLightAnimation = true;

        // 3. Sequence
        // Hold 800ms
        setTimeout(() => {
            this.greenLightStage = 2; // Trigger transition (Move + Turn Green)

            // Update Position to Target
            this.greenLightFloatingKey.x = targetRect.left;
            this.greenLightFloatingKey.y = targetRect.top;

        }, 800);

        // Finish after Transition (800ms + 1000ms transition = 1800ms)
        setTimeout(() => {
            // Commit to Board state

            // Remove from elsewhere in active row if present (Swap)
            const existingIndex = this.letters.findIndex((l, i) => l === targetChar && i !== targetIndex);
            if (existingIndex !== -1) {
                this.letters[existingIndex] = '';
                this.boxStatus[existingIndex] = '';
            }

            this.letters[targetIndex] = targetChar;
            this.boxStatus[targetIndex] = 2; // Green
            this.alphabetStatus[this.alphabet.indexOf(targetChar)] = 2;

            this.playSound('magic'); // 🪄✨

            // Cleanup Overlay
            // Small delay to prevent flicker?
            this.showGreenLightAnimation = false;
        }, 1800);

        // Move cursor if it was on the filled spot?
        // Logic should handle skipping.

        // Fix: Explicitly check if cursor is on a filled spot and move it
        if (this.boxStatus[this.cursor] === 2) {
            let newCursor = this.cursor;
            while (newCursor < this.wordLength && this.boxStatus[newCursor] === 2) {
                newCursor++;
            }
            if (newCursor < this.wordLength) {
                this.cursor = newCursor;
            }
        }
    },

    async hintBuyVowel() {
        if (this.hintsUsed >= this.maxHints) return;

        const vowels = ['A', 'E', 'I', 'O', 'U'];
        const answerVowels = vowels.filter(v => this.answer.includes(v));
        const unrevealedVowels = answerVowels.filter(v => {
            const idx = this.alphabet.indexOf(v);
            return this.alphabetStatus[idx] === '';
        });

        let targetVowel;
        if (unrevealedVowels.length > 0) {
            targetVowel = unrevealedVowels[Math.floor(Math.random() * unrevealedVowels.length)];
        } else {
            this.showMessage("All vowels have been found!");
            return;
        }

        this.hintsUsed++;
        this.showHintsModal = false;
        this.showHintsModal = false;

        // 1. Prepare Animation
        await new Promise(r => setTimeout(r, 100));

        // Find DOM element for target key
        const keyEls = Array.from(document.querySelectorAll('.noselect'));
        const targetKeyEl = keyEls.find(e => e.innerText.trim() === targetVowel);

        if (!targetKeyEl) {
            // Fallback if not found
            this.alphabetStatus[this.alphabet.indexOf(targetVowel)] = 1;
            return;
        }

        // Center Coordinates
        // Use same size as Letta Bomb (~3x normal?)
        // Let's pick a nice large fixed size for center, e.g. 100x100
        const cw = 80;
        const ch = 80;
        const cx = (window.innerWidth / 2) - (cw / 2);
        const cy = (window.innerHeight / 2) - (ch / 2);

        this.vowelFloatingKey = {
            char: targetVowel,
            x: cx,
            y: cy,
            w: cw,
            h: ch,
            fontSize: '2.5rem',
            opacity: 0 // Start hidden
        };
        this.vowelStage = 0;
        this.showVowelAnimation = true;

        // 2. Play Sequence

        // T+50ms: Fade In Gray (duration 0.5s default transition?)
        // User wants "display for 1s". So let's fade in quickly then hold.
        setTimeout(() => {
            this.vowelFloatingKey.opacity = 1;
        }, 50);

        // T+1000ms: Transition Gray -> Yellow (over 1s)
        setTimeout(() => {
            this.vowelStage = 1;
        }, 1000);

        // T+2000ms: Move to Keyboard (over 1s)
        setTimeout(() => {
            const rect = targetKeyEl.getBoundingClientRect();
            this.vowelStage = 2;

            this.vowelFloatingKey.x = rect.left;
            this.vowelFloatingKey.y = rect.top;
            this.vowelFloatingKey.w = rect.width;
            this.vowelFloatingKey.h = rect.height;
            this.vowelFloatingKey.fontSize = '1.25rem';

        }, 2000);

        // Finish (2000ms + 1000ms move = 3000ms)
        setTimeout(() => {
            // Commit state
            this.showVowelAnimation = false;
            this.alphabetStatus[this.alphabet.indexOf(targetVowel)] = 1; // Yellow
            this.playSound('magic');
            this.highlightKey = targetVowel; // Pulse
            setTimeout(() => { this.highlightKey = ''; }, 3000);

            this.showMessage(`Found vowel: ${targetVowel}!`);

        }, 3000);


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

        }, 400); // 400ms delay before moving

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


        // cursor at beginning? clear all other NON-HINT letters
        // Note: boxStatus[i] === 2 implies a Hint in the active row.
        if (this.cursor == 0) {
            for (let i = 0; i < this.wordLength; i++) {
                if (this.boxStatus[i] !== 2) {
                    this.letters[i] = '';
                    this.boxStatus[i] = '';
                }
            }
            // Do NOT wipe boxStatus completely if it has hints
        }

        // Advance cursor if currently on a hint
        while (this.cursor < this.wordLength && this.boxStatus[this.cursor] === 2) {
            this.cursor++;
        }

        if (this.cursor > this.wordLength - 1) return;

        // add letter to letters[] array
        this.letters[this.cursor] = l
        this.playSound('click');

        // advance cursor (skip filled/Green slots from hints)
        // Check next slot. If it's already filled by a hint (status 2?), skip it.
        // Actually, hintGreenLight sets boxStatus to 2.
        // But what if user just typed a letter? boxStatus is usually undefined/empty until evaluation.
        // So checking boxStatus[this.cursor + 1] === 2 is a good sign it's a hint.

        this.cursor++
        // Skip over any pre-filled hint letters
        while (this.cursor < this.wordLength && this.boxStatus[this.cursor] === 2) {
            this.cursor++;
        }
    },
    enter() {
        // Must be full word
        if (this.letters.filter(l => l).length !== this.wordLength) return;
        if (this.isWinner || this.isLoser) return;

        // Construct word
        const currentParams = this.letters.join('').toUpperCase();

        // Validate
        if (!this.validWordList.includes(currentParams.toLowerCase())) {
            this.isShaking = true;
            this.showMessage("Not in word list");
            this.playSound('invalid');
            this.triggerHaptic('invalid');
            setTimeout(() => { this.isShaking = false; }, 500);
            return;
        }

        // Prevent duplicates
        if (this.guesses.includes(currentParams)) {
            this.isShaking = true;
            this.playSound('backspace');
            this.showMessage("Already guessed!");
            setTimeout(() => { this.isShaking = false; }, 500);
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

        // If current cursor is > 0, we want to delete char at cursor-1.
        // BUT if char at cursor-1 is a Hint (Green/status 2), we should SKIP it and delete the one before?
        // Or just block deletion? Usually block deletion of hints.
        // Scan backwards from cursor until we find a non-hint.

        let targetCursor = this.cursor; // Start at current.

        // If we are at end (wordLength), or just empty slot.
        // We want to move back 1.
        // If that slot is hint, keep moving back.

        if (targetCursor === 0) return;

        // Move back at least once
        targetCursor--;

        // Check if this slot is a hint (boxStatus == 2)
        while (targetCursor >= 0 && this.boxStatus[targetCursor] === 2) {
            targetCursor--;
        }

        if (targetCursor < 0) return; // All previous are hints

        // Set cursor to this new spot
        this.cursor = targetCursor;
        this.letters[this.cursor] = ''; // erase
        this.playSound('backspace');
        this.isReadyToCheck = false;
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
        const appUrl = import.meta.env.VITE_APP_URL || '';
        console.log("Share URL:", appUrl);

        // Date format: "Jan 6"
        const dateOptions = { month: 'short', day: 'numeric' };
        const shortDate = new Date().toLocaleDateString('en-US', dateOptions);

        let titleString = (this.dailyChallenge) ? `Daily Challenge ${shortDate}` : `Endless Challenge`;

        // "WordLetta Daily Challenge Jan 13 | ✔️ X/6"
        let blurb = `${appName} ${titleString} | ${(this.isWinner ? '✔️' : '❌')} ${this.numGuesses}/6\n`
            + this.shareBlurb
            + `\n${appUrl}`;

        if (asImage) {
            try {
                const blob = await this.generateResultImage(titleString, this.isWinner ? 'WON' : 'LOST', this.numGuesses + '/6', appUrl);
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
                text: blurb,
                // url: appUrl, // Url is already in blurb, adding it here might duplicate on some platforms? 
                // But generally safe to include as structured data.
                url: appUrl,
            }).then(() => {
                // console.log('Shared successfully.')
            }).catch((error) => {
                console.log('Error sharing', error)
            });
        }
    },
    generateResultImage(title, status, score, url = '') {
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
    speakWord() {
        if (!this.answer) return;
        // Use Web Speech API
        const utterance = new SpeechSynthesisUtterance(this.answer.toLowerCase());
        utterance.lang = 'en-US';
        speechSynthesis.speak(utterance);
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
    startTimer(resume = false) {
        if ((this.timerStarted && !resume) || this.isWinner || this.isLoser) return;
        this.timerStarted = true;
        if (!resume) this.gameTime = 0;

        // Clear existing interval just in case
        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerInterval = setInterval(() => {
            if (!this.isPaused && !this.isAnyModalOpen) {
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
        // UI Handling: Toggle the Menu
        if (!this.timerStarted || this.isWinner || this.isLoser) return;

        const newState = !this.isPaused;
        this.setPause(newState);
        this.showPauseMenu = newState;
    },

    setPause(shouldPause) {
        this.isPaused = shouldPause;

        if (this.isPaused) {
            if (this.idleTimeout) clearTimeout(this.idleTimeout);
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }
        } else {
            this.resetIdleTimer();
            this.startTimer(true);
        }
        this.updateMusicState();
    },

    get isAnyModalOpen() {
        return this.showSettingsModal || this.showHelpModal || this.showReleaseNotesModal || this.showStatsModal || this.showNewGameModal || this.showHintsModal || this.showShareModal;
    },

    get isPauseModalVisible() {
        return this.showPauseMenu;
    },

    get formattedTime() {
        // Assume gameTime is in seconds (float or int)
        const gTime = Number(this.gameTime);
        const totalSeconds = Math.floor(gTime);
        const m = Math.floor(totalSeconds / 60).toString();
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        // Extract deciseconds from the fractional part
        const ds = Math.floor((gTime % 1) * 10).toString();
        return `${m}:${s}.${ds}`;
    },
    get formattedTimeSimple() {
        const totalSeconds = Math.floor(Number(this.gameTime));
        const m = Math.floor(totalSeconds / 60).toString();
        const s = (totalSeconds % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
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
    toggleReleaseNotes() {
        this.showReleaseNotesModal = !this.showReleaseNotesModal;
        if (this.showReleaseNotesModal) {
            // Close other modals if needed
            this.showSettingsModal = false;
        }
        // Logic handled by watcher now
        // this.checkModalPauseState(); // Redundant via watcher but safe
    },

    toggleSound() {
        if (!this.audioCtx) this.initAudio();
        this.settings.sound = !this.settings.sound;
        this.saveData();
        if (this.settings.sound) {
            // Play C5 (523.25 Hz), 0 delay, 0.1s duration
            this.playNote(523.25, 0, 0.1);
        }
    },
    toggleMusic() {
        this.settings.music = !this.settings.music;

        if (this.settings.music) {
            if (!this.settings.musicVolume || this.settings.musicVolume <= 0) {
                this.settings.musicVolume = this.settings.lastVolume || 0.5;
            }
            if (this.bgMusic) {
                this.bgMusic.volume = this.settings.musicVolume;
            }
        }

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
        } else if (type === 'invalid') {
            // Short Discordant "Eh-eh"
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(100, now + 0.1);

            gainNode.gain.setValueAtTime(0.2, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

            osc.start(now);
            osc.stop(now + 0.15);
            // Double beep?
            // Actually, a single low "donk" is fine.
        } else if (type === 'explosion') {
            // Real Boom: Noise + Sub
            const bufferSize = this.audioCtx.sampleRate * 0.5; // 0.5s
            const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            const noise = this.audioCtx.createBufferSource();
            noise.buffer = buffer;

            // Filter noise for 'rumble'
            const noiseFilter = this.audioCtx.createBiquadFilter();
            noiseFilter.type = 'lowpass';
            noiseFilter.frequency.setValueAtTime(800, now);
            noiseFilter.frequency.exponentialRampToValueAtTime(50, now + 0.4);

            const noiseGain = this.audioCtx.createGain();
            noiseGain.gain.setValueAtTime(0.8, now);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(this.audioCtx.destination);
            noise.start(now);

            // Sub-bass thud
            const subOsc = this.audioCtx.createOscillator();
            subOsc.type = 'triangle';
            subOsc.frequency.setValueAtTime(80, now);
            subOsc.frequency.exponentialRampToValueAtTime(20, now + 0.5);

            const subGain = this.audioCtx.createGain();
            subGain.gain.setValueAtTime(0.8, now);
            subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

            subOsc.connect(subGain);
            subGain.connect(this.audioCtx.destination);
            subOsc.start(now);
            subOsc.stop(now + 0.5);
        } else if (type === 'magic') {
            // Upward chimes / glisten
            const now = this.audioCtx.currentTime;
            for (let i = 0; i < 5; i++) {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);
                osc.type = 'sine';

                // Arpeggio: C5, E5, G5, C6, E6
                const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
                osc.frequency.setValueAtTime(freqs[i], now + (i * 0.08));

                gain.gain.setValueAtTime(0.05, now + (i * 0.08));
                gain.gain.exponentialRampToValueAtTime(0.001, now + (i * 0.08) + 0.4);

                osc.start(now + (i * 0.08));
                osc.stop(now + (i * 0.08) + 0.4);
            }
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
            this.bgMusic = new Audio('/audio/' + (this.settings.musicTrack || 'wordletta-dirty-dreamy.wav'));
            this.bgMusic.loop = true;
            this.bgMusic.volume = this.settings.musicVolume || 0.3;
        }
    },
    setMusicTrack(track) {
        this.settings.musicTrack = track;
        this.saveData();
        if (this.bgMusic) {
            const wasPlaying = !this.bgMusic.paused;
            this.bgMusic.src = '/audio/' + track;
            if (wasPlaying && this.settings.music) {
                this.bgMusic.play().catch(e => { });
            }
        } else {
            this.initMusic();
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

