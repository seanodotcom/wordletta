import * as clipboard from "clipboard-polyfill/text";
import { auth, db } from "./src/firebaseConfig";
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";

// Alpine.data('wordletApp', () => ({
export default () => ({
    title: 'WordLetta',
    version: '1.1',
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
    dailyChallenge: false,
    dailyChallengeComplete: false,
    answer: null,
    alphabet: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
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
            let str = g.split('').sort().reverse().join('').replaceAll(0, '').replaceAll(1, '🟡').replaceAll(2, '🟢')
            newArr.push(str || '⚪')
        })
        return newArr.join('\n')
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
                    this.syncStats();
                } else {
                    this.user = null;
                    // retrieve local stats if not logged in? 
                    // leveraging Alpine.$persist would need to be manual here if we removed it from the property def
                    // Let's restore from localStorage manually if needed:
                    const local = localStorage.getItem('_x_endlessStats');
                    if (local) this.endlessStats = JSON.parse(local);
                }
            });
        } else {
            console.log("Firebase Auth not initialized (dev mode)");
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

        this.alphabetStatus = []
        for (let i = 0; i <= this.alphabet.length; i++) {
            this.alphabetStatus[i] = ''
        }

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
        }

        // only respond to letters A-Z
        if ((/^[a-z]$/i).test(k)) {
            this.letterClicked(k.toUpperCase())
        }
    },
    newGame() {
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
        this.letters.forEach(g => { this.alphabetStatus[this.alphabet.indexOf(g)] = (g) ? 0 : null })

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
        }
        // CHECK: game over? (max # of guesses reached?)
        else if (this.numGuesses == this.totalGuesses) {
            this.$nextTick(() => this.gameLost())
        }

        // game on. done evaluating current guess, reset cursor & ready check
        this.isReadyToCheck = false
        if (this.cursor == this.wordLength) this.cursor = 0
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

        // if cursor > word length, and word is valid (in answersN[] array), ready to check
        if ((this.cursor == this.wordLength - 1) && (this.validWordList.includes(this.guess))) this.isReadyToCheck = true

        // advance cursor
        this.cursor++
    },
    enter() {
        // if guess is not ready, or game is over, do nothing
        if (!this.isReadyToCheck) return
        if (this.isWinner || this.isLoser) return

        this.evaluateGuess()
    },
    backspace() {
        // if game is over, do nothing
        if (this.isWinner || this.isLoser) return

        // erase letter & decrement cursor
        this.letters[this.cursor - 1] = ''
        this.cursor--
        if (this.cursor < 0) this.cursor = 0

        // if erasing a letter, guess is no longer ready to check
        this.isReadyToCheck = false
    },
    gameWon() {
        // window.alert('You got it in ' + this.numGuesses + ((this.numGuesses < this.wordLength) ? '!' : '.') + ' Congrats!\n\nThe answer was: ' + this.answer)
        this.isWinner = true
        this.logStats()
        this.showShareModal = true
    },
    gameLost() {
        // window.alert('Sorry, the answer was: ' + this.answer + '\n\nTry again!')
        this.isLoser = true
        this.logStats()
        this.showShareModal = true
    },
    shareGame() {
        // build full shareBlurb
        // let blurb = 'WordLET 2.1.22, 4/6\n' + this.shareBlurb  // DEBUG!
        // let blurb = 'Wordlet | Daily Challenge ' + this.dailyChallengeDay + ', ' + this.numGuesses + '/6\n'
        let blurb = 'WordLetta.com | Daily Challenge ' + this.dailyChallengeDay + ' '
            + (this.isWinner ? '✔️' : '❌') + ' ' + this.numGuesses + '/6\n'
            + this.shareBlurb

        // copy share copy to clipboard
        clipboard.writeText(blurb).then(
            () => {
                // console.log("success!"); 
                this.$refs.shareButton.innerText = "Copied!"
                setTimeout(() => { this.$refs.shareButton.innerText = "Share your score!" }, 2000);
            },
            () => { console.log("error!"); }
        );

        // launch browser share sheet
        if (navigator.share) {  // https://stackoverflow.com/a/55218902/5701
            navigator.share({
                title: 'WordLetta',
                text: 'Check out my WordLetta score!',
                url: 'http://sean-o.com/wordlet',
            }).then(() => {
                // console.log('Shared successfully.')
            }).catch((error) => {
                console.log('Error sharing', error)
            });
        } else {
            // console.log('Sharing is not supported on this browser, do it the old way.');
        }
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
                    history: arrayUnion(statsObj)
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
        } else {
            // New user doc
            await setDoc(userRef, {
                email: this.user.email,
                history: this.endlessStats // push any local stats? 
            });
        }
    },
    resetStats() {
        this.endlessStats = []
        this.dailyStats = []
        this.dailyChallengeComplete = false
    }

})