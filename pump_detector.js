const binance = require('node-binance-api')
const express = require('express')
const path = require('path')
var _ = require('lodash')
var moment = require('moment')
var numeral = require('numeral')
var readline = require('readline')
var fs = require('fs')
const TelegramBot = require('node-telegram-bot-api');
// const play = require('audio-play')
// const load = require('audio-loader')
const nodemailer = require('nodemailer')

//////////////////////////////////////////////////////////////////////////////////

// https://www.binance.com/restapipub.html
const APIKEY = '7hxRkF3KTID2EOnnTPxEFUjXBQinBMoA8TBFVfFUuBsUgtnTe5Zo3NHtCqqtFO54'
const APISECRET = 'wHGQ9BIKPieC1a82JtPVxnSpBC4MQO4h5F6yLQKc9mHRATz8MNOo9d9hKxFQsgf9'

const wait_time = 1000          // ms
const trading_fee = 0.1         // pourcent


// API initialization //
binance.options({
    'APIKEY': APIKEY,
    'APISECRET': APISECRET,
    'reconnect': true
});

///////////////////////////////////////////////////////////////////////////////////

// replace the value below with the Telegram token you receive from @BotFather
const token = '565941385:AAEnnyP1t54NMuKcHla2a2OhhUUWzqx5wwo';

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {polling: true});

const chatId = '-1001245808874';

///////////////////////////////////////////////////////////////////////////////////

let btc_price = 0

let pairs = []

let depth_bids = {}
let depth_asks = {}
let depth_diff = {}

let minute_prices = {}
let hourly_prices = {}

let tracked_pairs = []
let tracked_data = {}
let total_pnl = {}
let intervals = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];

console.log('------------ NBT starting -------------')

async function run() {

    //if (sound_alert) load('./alert.mp3').then(play);
    await sleep(2)

    console.log('------------------------------')
    console.log(' start get_BTC_price')
    console.log('------------------------------')
    btc_price = await get_BTC_price()
    console.log('------------------------------')
    console.log('BTC price: $' + numeral(btc_price).format('0,0'))
    console.log('------------------------------')

    await sleep(2)

    console.log('------------------------------')
    console.log(' get_BTC_pairs start')
    console.log('------------------------------')
    pairs = await get_BTC_pairs()
    console.log('------------------------------')
    pairs = pairs.slice(0, 1) //for debugging purpose
    console.log("Total BTC pairs: " + pairs.length)
    console.log('------------------------------')

    await sleep(2)

    console.log('------------------------------')
    console.log(' run detector')
    console.log('------------------------------')
    await get_candleSticks_for_BTC_pairs(intervals[0]);
}


sleep = (x) => {
    return new Promise(resolve => {
        setTimeout(() => { resolve(true) }, x )
    });
}

get_BTC_price = () => {
    return new Promise(resolve => {
        binance.websockets.candlesticks(['BTCUSDT'], "1m", (candlesticks) => {
            let { e:eventType, E:eventTime, s:symbol, k:ticks } = candlesticks;
            let { o:open, h:high, l:low, c:close, v:volume, n:trades, i:interval, x:isFinal, q:quoteVolume, V:buyVolume, Q:quoteBuyVolume } = ticks;
            btc_price = close
            resolve(btc_price)
        })
    })
}

get_BTC_pairs = () => {
    return new Promise(resolve => {
        binance.exchangeInfo((error, data) => {
            if (error) {
                console.log( error )
                resolve([])
            }
            if (data) {
                console.log( data.symbols.length + " total pairs")
                resolve( data.symbols.filter( pair => pair.symbol.endsWith('BTC') ).map(pair=>pair.symbol) )
            }
        })
    })
}


get_candleSticks_for_BTC_pairs = async (interval) => {
    for (var i = 0; i < pairs.length; i++) {
        await getPrevMinutePrices(pairs[i], interval);
        await sleep(wait_time)

        await trackPrice(pairs[i], interval);
        await sleep(wait_time)
    }
}

getPrevMinutePrices = (pair, interval) => {
    return new Promise(resolve => {
        binance.candlesticks(pair, interval, (error, ticks, symbol) => {
            if (error) {
                console.log( pair + " getPrevMinutePrices ERROR " + error )
                resolve(true)
            }

            if (ticks) {
                console.log( pair + ' got data')
                for (var i = 0; i < ticks.length; i++) {
                    let [time, open, high, low, close, volume, closeTime, assetVolume, trades, buyBaseVolume, buyAssetVolume, ignored] = ticks[i];
                    let pair_data = create_pair_data(tracked_pairs, symbol, close, volume, buyBaseVolume, btc_price);
                }

                resolve(true)
            }
        }, {limit: 2})
    })
}

trackPrice = (pair, interval) => {
    return new Promise(resolve => {
        binance.websockets.candlesticks(pair, interval, (candlesticks) => {
            let { e:eventType, E:eventTime, s:symbol, k:ticks } = candlesticks;
            let { o:open, h:high, l:low, c:close, v:volume, n:trades, i:interval, x:isFinal, q:quoteVolume, V:buyVolume, Q:quoteBuyVolume } = ticks;

            if (isFinal) {
                let pair_data = create_pair_data(tracked_pairs, symbol, close, volume, buyVolume, btc_price);

                var isPumping = calculate_ticks_data(pair_data.data)
                console.log(pair_data.data);
                console.log(`qVolume: ${quoteVolume} quoteBuyVolume: ${quoteBuyVolume}`);
                if (isPumping) {
                    var message = `[TESTING ${interval} Folloing Tick data] ${pair} + is pumping. Current price:  ${close}
                                \n Previous volume: ${pair_data.data[0].volume} Current volume: ${pair_data.data[1].volume}
                                \n https://www.binance.com/tradeDetail.html?symbol=${symbol.slice(0, -3)}_BTC`;
                    console.log(message);
                    bot.sendMessage(chatId, message);
                }
            }

            resolve(true);
        });
    })
}

create_pair_data = (pairs, symbol, close, volume, buyBaseVolume, btc_price) => {
    var pair_data = pairs.filter(x => x.symbol === symbol)[0];
    if (!pair_data) {
        pair_data = {
            symbol: symbol,
            data: [{
                date: moment().format('MMMM Do YYYY, h:mm:ss a'),
                timestamp: Date.now(),
                price: close,
                volume: volume,
                buyVolume: buyBaseVolume,
                usdvolume: volume*close*btc_price
            }]
        }

        tracked_pairs.push(pair_data)
    }  else {
        if (pair_data.data.length > 1) {
            pair_data.data.shift();
        }

        pair_data.data.push({
            date: moment().format('MMMM Do YYYY, h:mm:ss a'),
            timestamp: Date.now(),
            price: close,
            volume: volume,
            buyVolume: buyBaseVolume,
            usdvolume: volume*close*btc_price
        })
    }

    return pair_data;
}

calculate_ticks_data = (ticks) => {
    let [first_tick, last_tick] = ticks;

    if (first_tick.volume * 1.4 <= last_tick.volume && first_tick.buyVolume < last_tick.buyVolume) {
        return true;
    }

    return false;
}

run()

const app = express()
app.get('/', (req, res) => res.send(tracked_pairs))
app.listen(9874, () => console.log('NBT api accessable on port 80'))
