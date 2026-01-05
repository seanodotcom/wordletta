import './index.css'

// https://alpinejs.dev/globals/alpine-data
import Alpine from 'alpinejs'
import wordletApp from './wordletapp.module'
Alpine.data('wordletApp', wordletApp)

import persist from '@alpinejs/persist'
Alpine.plugin(persist)

window.Alpine = Alpine
Alpine.start()

// prevent FOUC
import './unhide.css'