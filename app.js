//IMPORTS
const app = require('express')();
const server = require('http').createServer(app);
const bodyParser = require('body-parser');
const TorrentSearchApi = require('torrent-search-api');
const torrentSearch = new TorrentSearchApi();
const io = require("socket.io")(server);
const OS = require('opensubtitles-api');
const OpenSubtitles = new OS({
    useragent: 'TemporaryUserAgent',
    username: '120131',
    password: 'google31',
    ssl: true
});
const readTorrent = require('read-torrent');
const tempDir = require('os').tmpdir();
const peerflix = require('peerflix');
const uuid = require('node-uuid');
const omx = require('omxctrl');
const path = require('path');
const fs = require('fs-extra');
const getPort = require('get-port');
const cons = require('./console');
const {exec} = require('child_process');
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
let enginePort = -1;

//FUNCTION DEFINITIONS
let stop = function () {
    if (!engine) return;
    omx.stop();
    engine.destroy();
    engine = null;
};

let createTempFilename = function () {
    return path.join(tempDir, 'RaspPi-Server_' + uuid.v4());
};

let clearTempFiles = function () {
    fs.readdir(tempDir, function (err, files) {
        if (err) return;
        files.forEach(function (file) {
            if (file.substr(0, 13) === 'RaspPi-Server') {
                fs.removeSync(path.join(tempDir, file));
            }
        });
    });
};

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

//THIS DOES NOT WORK ON EVERY TV (EXPERIMENTAL)
let switchTvToPi = function () {
    let swithToPi = "echo \"as\" | cec-client -s";
    let turnOn = "echo \"on 0\" | cec-client -s";
    let turnOff = "echo \"standby 0\" | cec-client -s";

    exec(swithToPi, (err, stdout, stderr) => {});
};


//ROUTE
app.use(bodyParser.json());

app.get('/', function (req, res) {
    res.status(200).send("Connected");
});

//CATCH UNHANDLED ERRORS AND PRINT TO FILE
process.on('uncaughtException', err => {
    createErrorLog("Uncaught Exception {port : " + PORT + ", state : " + state + ", enginePort : " + enginePort + "}\n" + err);
    cons.createInfoPanel("-", "-", "Uncaught Exception, manual restart required. See logs for details.", 0);
    process.exit();
});


//SOCKET
let clientCount = 0;
io.on('connection', function (socket) {
    clientCount += 1;
    cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    socket.emit("fullstate", state);

    socket.on('requestStatus', function () {
        socket.emit("fullstate", state);
    });

    socket.on('play', function (msg) {

        if (engine) stop();

        if (!msg.torrent.title) {
            createErrorLog("Received empty play command -> should not be possible");
            socket.emit("message", {"message": "No torrent URL specified", "last": true});
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

        readTorrent(state.torURL, function (err, torrent) {
            if (err) {
                createErrorLog(err);
                socket.emit("message", {"message": "Invalid torrent URL", "last": true});
                resetState();
                io.sockets.emit("fullstate", state);
                return
            }

            switchTvToPi();

            clearTempFiles();

            let startTorrent = function (torr, opts, subFailed) { //START PLAYING TORRENT + (OPTIONAL) SUBTITLES
                let tempPath = createTempFilename();
                getPort().then(newPort => {
                    enginePort = newPort;
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

                        engine = peerflix(torr, {
                            connections: 100,
                            path: tempPath,
                            buffer: (1.5 * 1024 * 1024).toString(),
                            port: newPort
                        });
                        engine.server.on('listening', function () {
                            omx.play('http://127.0.0.1:' + newPort + '/', opts);

                            omx.once('ended', function () {
                                resetState();
                                io.sockets.emit("fullstate", state);
                                cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
                            });

                            if (subFailed) {
                                state.subTitle = "-";
                                state.subURL = "-";
                                socket.emit("message", {"message": "Subtitles failed to download", "last": true});
                            }
                            state.state = 'PLAYING';
                            io.sockets.emit("fullstate", state);
                            io.sockets.emit("message", {"message": "Playback will begin shortly", "last": true});
                            cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
                        });
                    });
                });
            };

            //IF SUBTITLES DOWNLOAD THEM
            let opts = [];
            opts.push('-b');
            if (state.subURL !== "-") {
                socket.emit("message", {"message": "Downloading subtitles...", "last": false});
                cons.createInfoPanel(state.torTitle, state.subTitle, "DOWNLOADING SUBTITLES", clientCount);

                const subdir = path.join(tempDir, 'RaspPi-Server_Subtitles');

                require('request')({
                    url: state.subURL,
                    encoding: null
                }, (error, response, data) => {
                    if (error) {
                        createErrorLog(error);
                        startTorrent(torrent, opts, true);
                    } else {
                        require('zlib').unzip(data, (error2, buffer) => {
                            if (error2) {
                                createErrorLog(error2);
                                startTorrent(torrent, opts, true);
                            } else {
                                const subtitle_content = buffer.toString('UTF-8');

                                fs.mkdirsSync(subdir);

                                let subpath = path.join(subdir, 'subs.srt');
                                fs.writeFile(subpath, subtitle_content, function (err) {
                                    if (err) {
                                        createErrorLog(err);
                                        startTorrent(torrent, opts, true);
                                    } else {
                                        opts.push('--subtitles');
                                        opts.push(subpath);
                                        startTorrent(torrent, opts, false);
                                    }
                                });
                            }
                        });
                    }
                });
            } else {
                startTorrent(torrent, opts, false);
            }
        });
    });

    socket.on('pause', function () {
        if (state.state === 'IDLE') {
            socket.emit("message", {"message": "No video playing", "last": true});
            return;
        }
        state.state = (state.state === 'PAUSED') ? 'PLAYING' : 'PAUSED';
        omx.pause();
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
        io.sockets.emit("state", state.state);
    });

    socket.on('stop', function () {
        stop();
        resetState();
        io.sockets.emit("state", state.state);
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('disconnect', function () {
        clientCount -= 1;
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('error', function (error) {
        createErrorLog(error);
        socket.emit('fullstate', state);
        socket.emit('message', {"message": "Unknown error", "last": true});
        cons.createInfoPanel(state.torTitle, state.subTitle, state.state, clientCount);
    });

    socket.on('searchTorrent', function (data) {

        if (!data) {
            socket.emit("message", {"message": "No search term", "last": true});
            createErrorLog("Received empty torrent search query -> should not be possible");
        } else {
            torrentSearch.enableProvider('1337x');

            torrentSearch.search(data, 'All', 15)
                .then(torrents => {
                    socket.emit("torrentResults", torrents);
                })
                .catch(err => {
                    createErrorLog("SEARCHTORRENT - " + err);
                    socket.emit("message", {"message": "Cannot connect to torrent sources", "last": true});
                });
        }
    });

    socket.on('searchSubtitle', function (data) {

        if (!data) {
            socket.emit("message", {"message": "No search term", "last": true});
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
                createErrorLog("SEARCHSUBTITLE - " + err);
                socket.emit("message", {"message": "Failed to search", "last": true});
            });
        }
    });

    socket.on('getTorrentURL', function (data) {
        if (!data) {
            socket.emit("message", {"message": "Torrent not specified", "last": true});
            createErrorLog("Received empty getTorrentURL query -> should not be possible");
        } else {
            torrentSearch.getMagnet(JSON.parse(data))
                .then(magnet => {
                    socket.emit("magnetURL", magnet);
                })
                .catch(err => {
                    createErrorLog(err);
                    socket.emit("message", {"message": "Failed while parsing torrent", "last": true});
                });
        }
    });

    for (let route in mappings) {
        (function (method) {
            socket.on(route, function () {
                omx[method]();
                socket.emit('message', {"message": "Command received", "last": true});
            });
        })(mappings[route]);
    }
});

module.exports = function () {
    cons.createInfoPanel("-", "-", "IDLE", 0);
    server.listen(PORT);
};