//IMPORTS
const app = require('express')();
const server = require('http').createServer(app);
const bodyParser = require('body-parser');
const TorrentSearchApi = require('torrent-search-api');
const torrentSearch = new TorrentSearchApi();
const io = require("socket.io")(server);
const OS = require('opensubtitles-api');
const OpenSubtitles = new OS({
    useragent:'TemporaryUserAgent',
    username: '120131',
    password: 'google31',
    ssl: true
});
const readTorrent = require('read-torrent');
const cons = require('./console');
const omdbApi = require('omdb-client');
const ptt = require("parse-torrent-title");

//DEFINITIONS
const PORT = process.argv[2] || 9090;
let engine;
const mappings = {
    'speedup': 'increaseSpeed',
    'speeddown': 'decreaseSpeed',
    'nextaudio': 'nextAudioStream',
    'prevaudio': 'previousAudioStream',
    'nextsubtitle': 'nextSubtitleStream',
    'prevsubtitle': 'previousSubtitleStream',
    'togglesubtitle': 'toggleSubtitles',
    'volumeup': 'increaseVolume',
    'volumedown': 'decreaseVolume',
    'forward': 'seekForward',
    'backward': 'seekBackward',
    'fastforward': 'seekFastForward',
    'fastbackward': 'seekFastBackward'
};
let state = {"state" : "IDLE", "image" : "-", "title" : "-", "season" : 0, "episode" : 0, "torTitle" : "-", "subTitle" : "-", "torURL" : "-", "subURL" : "-"};

//FUNCTION DEFINITIONS

let resetState = function () {
    state.state = 'IDLE';
    state.torTitle = "-";
    state.subTitle = "-";
    state.torURL = "-";
    state.subURL = "-";
    state.image = "-";
    state.title = "-";
    state.season = 0;
    state.episode = 0;
};

let createErrorLog = function (error) {
    let date = new Date();
    let message = date + ": " + error + "\n";

    fs.appendFile("logs.txt", message, function (error) {
        if (error) throw error;
    });
};

//ROUTE
app.use(bodyParser.json());

app.get('/', function(req, res){
    res.status(200).send("Connected");
});

process.on('uncaughtException', err => {
    console.log()
})


//SOCKET
let clientCount = 0;
io.on('connection', function(socket){
    clientCount += 1;
    cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    socket.emit("fullstate", state);

    socket.on('requestStatus', function() {
        socket.emit("fullstate", state);
    });

    socket.on('play', function(msg) {

        if (engine) stop();

        if (!msg.torrent.title) {
            createErrorLog("Received empty play command -> should not be possible");
            socket.emit("message", {"message" : "No torrent URL specified", "last" : true});
            return
        }

        state.torTitle = msg.torrent.title;
        state.torURL = msg.torrent.url;

        if (msg.subtitle == null) {
            state.subTitle = "-";
            state.subURL = "-";
        } else {
            state.subTitle = msg.subtitle.title;
            state.subURL = msg.subtitle.url;
        }

        readTorrent(state.torURL, function(err, torrent) {
            if (err) {
                socket.emit("message", {"message" : "Invalid torrent URL", "last" : true});
                resetState();
                io.sockets.emit("fullstate", state);
                return
            }

            let startTorrent = function(torr, opts, subFailed) {
                let torLookup = ptt.parse(state.torTitle);
                state.title = ptt.parse(state.torTitle).title;
                state.season = (torLookup.season === undefined) ? 0 : torLookup.season;
                state.episode = (torLookup.episode === undefined) ? 0 : torLookup.episode;
                //TRY TO FIND COVER ART
                let params = {
                    apiKey: '9a2a330d',
                    title: state.title
                };
                omdbApi.get(params, function(err, data) {

                    if (!err && !(data.Poster === "N/A")) {
                        state.image = data.Poster;
                    }

                    state.state = 'PLAYING';
                    if (subFailed) {
                        state.subTitle = "-";
                        state.subURL = "-";
                        socket.emit("message", {"message" : "Subtitles failed to download", "last" : true});
                    }
                    io.sockets.emit("fullstate", state);
                    io.sockets.emit("message", {"message" : "Playback will begin shortly", "last" : true});
                    cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
                });
            };

            if (state.subURL !== "-") {
                socket.emit("message", {"message" : "Downloading subtitles...", "last" : false});
                cons.createInfoPanel(state.torTitle, state.subTitle, "DOWNLOADING SUBTITLES", clientCount);
                setTimeout(function(){
                    startTorrent(torrent, [], false); //or true for testing
                }, 5000);
            } else {
                startTorrent(torrent, [], false);
            }
        });
    });

    socket.on('pause', function () {
        if (state.state === 'IDLE') {
            socket.emit("message", {"message" : "No video playing", "last" : true});
            return;
        }
        state.state = (state.state === 'PAUSED') ? 'PLAYING' : 'PAUSED';
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
        io.sockets.emit("state", state.state);
    });

    socket.on('stop', function () {
        resetState();
        io.sockets.emit("state", state.state);
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('disconnect', function() {
        clientCount -= 1;
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('error', function(error) {
        createErrorLog(error);
        socket.emit('fullstate', state);
        socket.emit('message', {"message" : "Unknown error", "last" : true});
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('searchTorrent', function(data) {
        if (!data) {
            socket.emit("message", {"message" : "No search term", "last" : true});
            createErrorLog("Received empty torrent search query -> should not be possible");
        } else {
            torrentSearch.enableProvider('1337x');

            torrentSearch.search(data,'All', 15)
                .then(torrents => {
                    socket.emit("torrentResults", torrents);
                })
                .catch(err => {
                    createErrorLog("SEARCHTORRENT - " + err);
                    socket.emit("message", {"message" : "Cannot connect to torrent sources", "last" : true});
                });
        }
    });

    socket.on('searchSubtitle', function(data) {
        if (!data) {
            socket.emit("message", {"message" : "No search term", "last" : true});
            createErrorLog("Received empty subtitle search query -> should not be possible");
        } else {
            OpenSubtitles.search({
                sublanguageid: 'eng',
                limit: '10',
                query: data,
                gzip: true
            }).then(subtitles => {
                socket.emit("subtitleResults", subtitles);
            }).catch(err => {
                createErrorLog("SEARCHTORRENT - " + err);
                socket.emit("message", {"message" : "Failed to search", "last" : true});
            });
        }
    });

    socket.on('getTorrentURL', function(data) {
        if (!data) {
            socket.emit("message", {"message" : "Torrent not specified", "last" : true});
            createErrorLog("Received empty getTorrentURL query -> should not be possible");
        } else {
            torrentSearch.getMagnet(JSON.parse(data))
                .then(magnet => {
                    socket.emit("magnetURL", magnet);
                })
                .catch(err => {
                    createErrorLog(err);
                    socket.emit("message", {"message" : "Failed while parsing torrent", "last" : true});
                });
        }
    });

    for (let route in mappings) {
        (function(method) {
            socket.on(route, function() {
                socket.emit('message', {"message" : "Command received", "last" : true});
            });
        })(mappings[route]);
    }
});

module.exports = function() {
    cons.createInfoPanel("-", "-", "IDLE", 0);
    server.listen(PORT);
};