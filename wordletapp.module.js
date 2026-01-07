import * as clipboard from "clipboard-polyfill/text";
import { auth, db } from "./src/firebaseConfig";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import confetti from "canvas-confetti";

// Alpine.data('wordletApp', () => ({
export default () => ({
    title: 'WordLetta',
    version: '1.4.0',
    user: null,
    wordLength: 6,
    totalGuesses: 6,
    correctLetters: 0,
    cursor: 1,
    hardMode: false,
    isWinner: false,
    isLoser: false,
    isReadyToCheck: false,
    showNewGameModal: true,
    showShareModal: false,
    showStatsModal: false,
    showSettingsModal: false,
    showReleaseNotesModal: false,
    dailyChallenge: false,
    dailyChallengeComplete: false,
    answer: null,
    toastMessage: '',
    showToast: false,
    settings: {
        sound: true,
        keyboardLayout: 'QWERTY'
    },
    LAYER_DEFS: {
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
    },
    alphabet: [],
    keyboardRows: [],
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
    get guess() { return this.letters.length ? this.letters.join('').toLowerCase() : null },
    get numGuesses() { return this.guesses ? this.guesses.length : 0 },
    get dailyChallengeDay() {
        const now = new Date()
        const start = new Date(2025, 1, 0)
        const diff = Number(now) - Number(start)
        return Math.floor(diff / (1000 * 60 * 60 * 24))
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
        this.startTime = new Date();
        // auth check
        if (auth) {
            onAuthStateChanged(auth, (user) => {
                if (user) {
                    this.user = user;
                    this.syncStats(); // This will also sync settings
                } else {
                    this.user = null;
                    this.loadLocalSettings();
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
    newGame(force = false) {
        if (!force && this.numGuesses > 0 && !this.isWinner && !this.isLoser) {
            if (!confirm("Game in progress! Are you sure you want to quit?")) return;
        }
        this.showStatsModal = false
        this.showNewGameModal = false
        this.init()
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
                this.playSound('match');
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

        // push latest guess
        this.guesses.push(this.letters.join(''))

        // CHECK: winner?
        if (this.correctLetters == this.wordLength) {
            this.$nextTick(() => this.gameWon())
            this.playSound('win');
        }
        // CHECK: game over? (max # of guesses reached?)
        else if (this.numGuesses == this.totalGuesses) {
            this.$nextTick(() => this.gameLost())
            this.playSound('loss');
        }

        // game on. done evaluating current guess, reset cursor & ready check
        this.isReadyToCheck = false
        if (this.cursor == this.wordLength) this.cursor = 0

        // gracefull clear active row

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
        // window.alert('You got it in ' + this.numGuesses + ((this.numGuesses < this.wordLength) ? '!' : '.') + ' Congrats!\n\nThe answer was: ' + this.answer)
        this.isWinner = true
        this.logStats()
        this.confettiWin() // Fire confetti!
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
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
            confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
        }, 250);
    },
    gameLost() {
        // window.alert('Sorry, the answer was: ' + this.answer + '\n\nTry again!')
        this.isLoser = true
        this.logStats()
        this.showShareModal = true
    },
    async shareGame(asImage = false) {
        // build full shareBlurb
        // Configurable APP_NAME / URL
        const appName = import.meta.env.VITE_APP_NAME || 'WordLetta';
        const appUrl = import.meta.env.VITE_APP_URL || 'wordletta.com'; // fallback if env missing

        // Date format: "Jan 6"
        const dateOptions = { month: 'short', day: 'numeric' };
        const shortDate = new Date().toLocaleDateString('en-US', dateOptions);

        let title = (this.dailyChallenge) ? `Daily Challenge ${shortDate}` : `Random ${this.wordLength}-Letter Game`

        // Random Phrase
        const phrase = this.sharePhrases[Math.floor(Math.random() * this.sharePhrases.length)];

        let blurb = `${appName} | ${title} | ${phrase}\n`
            + (this.isWinner ? '✔️' : '❌') + ' ' + this.numGuesses + '/6\n'
            + this.shareBlurb
            + `\n${appUrl}`;

        if (asImage) {
            try {
                const blob = await this.generateResultImage(title, this.isWinner ? 'WON' : 'LOST', this.numGuesses + '/6');
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
    generateResultImage(title, status, score) {
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
            ctx.fillText('wordletta.com', width / 2, height - 20);

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
            }
        } else {
            // New user doc
            await setDoc(userRef, {
                email: this.user.email,
                history: this.endlessStats, // push any local stats? 
                settings: this.settings
            });
        }
        // Always apply layout (defaults or loaded)
        this.setKeyboardLayout(this.settings.keyboardLayout, false);
    },
    resetStats() {
        this.endlessStats = []
        this.dailyStats = []
        this.dailyChallengeComplete = false
    },
    loadLocalSettings() {
        const stored = localStorage.getItem('wordletta_settings');
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                // merge to ensure new keys exist
                this.settings = { ...this.settings, ...parsed };
            } catch (e) { console.error('Error loading settings', e) }
        }
        // Apply layout
        this.setKeyboardLayout(this.settings.keyboardLayout, false); // false = don't save again
    },
    saveData() {
        // Consolidated save function
        if (this.user) {
            this.syncStats();
        } else {
            localStorage.setItem('wordletta_settings', JSON.stringify(this.settings));
        }
    },
    toggleSound() {
        this.settings.sound = !this.settings.sound;
        this.saveData();
    },
    setKeyboardLayout(layoutName, save = true) {
        if (!this.LAYER_DEFS[layoutName]) return;

        const oldAlphabet = [...this.alphabet];
        const oldStatus = [...this.alphabetStatus];

        // Map status to letter
        let statusMap = {};
        oldAlphabet.forEach((letter, index) => {
            statusMap[letter] = oldStatus[index];
        });

        // Set New Layout
        this.settings.keyboardLayout = layoutName;
        this.keyboardRows = this.LAYER_DEFS[layoutName];
        this.alphabet = this.keyboardRows.flat();

        // Rebuild Status Array in new order
        this.alphabetStatus = this.alphabet.map(letter => statusMap[letter] || '');

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
        } else if (type === 'enter') {
            osc.frequency.setValueAtTime(400, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
            gainNode.gain.setValueAtTime(0.2, now);
            gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
            osc.start(now);
            osc.stop(now + 0.1);
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
    }

})