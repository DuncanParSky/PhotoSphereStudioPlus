const config = require('./config.json');

const host = config.host;
const port = config.port;
const openWebBrowser = config.openWebBrowser; // Set to false if running as a server

let full_url = "";
let protocol = config.https ? "https://" : "http://";

full_url = port && !config.https ? `${protocol}${host}:${port}` : `${protocol}${host}`;

console.log("Server running on: " + full_url);

// Google API credentials
const clientId = config.clientId; 
const clientSecret = config.clientSecret; 

// Open the browser if configured
const open = require('open');
if (openWebBrowser) {
    (async () => {
        await open(full_url);
    })();
}

const favicon = require('serve-favicon');
const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const upload = require("express-fileupload");
const request = require("request");
const app = express();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(
    upload({
        preserveExtension: true,
        safeFileNames: true,
        limits: { fileSize: 75 * 1024 * 1024 },
    })
);

app.use(express.static(__dirname + '/public'));
app.set('view engine', 'ejs');
app.use(favicon(__dirname + '/public/assets/icons/favicon.ico'));

app.get('/', function (req, res) {
    res.render('pages/index', {
        full_url: full_url,
        clientId: clientId,
        domain: config.host
    });
});

app.get('/upload', function (req, res) {
    res.render('pages/upload');
});

app.post('/upload', function (req, res) {
    let latitude = req.body["lat"];
    let longitude = req.body["long"];
    let heading = req.body["head"];
    let placespot = req.body["place"];
    let level = req.body["lev"];
    let levelname = req.body["levname"];
    let key = req.cookies["oauth"];

    if (!key) return res.redirect('/');

    if (!req.files) {
        return res.status(400).render('pages/error', {
            errorCode: 400,
            errorStatus: "Missing File",
            errorMessage: "Missing File",
            response: "Error: Missing File"
        });
    }

    const options = {
        method: 'POST',
        url: 'https://streetviewpublish.googleapis.com/v1/photo:startUpload',
        headers: { Authorization: `Bearer ${key}` }
    };

    request(options, function (error, response) {
        if (error) {
            console.log(error);
            return res.status(500).render('pages/error', {
                errorCode: 500,
                errorStatus: "ERROR",
                errorMessage: "Error with getting upload URL",
                response: JSON.stringify(JSON.parse(response.body), null, 4)
            });
        }

        let uploadUrl = JSON.parse(response.body)["uploadUrl"];

        const uploadOptions = {
            method: 'POST',
            url: uploadUrl,
            headers: { Authorization: `Bearer ${key}` },
            body: req.files.file.data
        };

        request(uploadOptions, function (uploadError) {
            if (uploadError) {
                console.log(uploadError);
                return res.status(500).render('pages/error', {
                    errorCode: 500,
                    errorStatus: "UPLOAD ERROR",
                    errorMessage: "Error uploading to Google's API",
                    response: uploadError
                });
            }

            let metadata = {
                uploadReference: { uploadUrl: uploadUrl }
            };

            if (latitude && longitude) {
                metadata.pose = {
                    latLngPair: { latitude: latitude, longitude: longitude },
                };

                if (level || levelname) {
                    metadata.pose.level = {};
                    if (level) metadata.pose.level.number = level;
                    if (levelname) metadata.pose.level.name = levelname;
                }

                if (heading) metadata.pose.heading = heading;
            }

            if (placespot) metadata.places = { placeId: placespot };

            const metadataOptions = {
                method: 'POST',
                url: 'https://streetviewpublish.googleapis.com/v1/photo',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(metadata)
            };

            request(metadataOptions, function (metadataError, metadataResponse) {
                if (metadataError) {
                    console.log(metadataError);
                    return res.status(500).render('pages/error', {
                        errorCode: 500,
                        errorStatus: "ERROR",
                        errorMessage: "Error setting metadata",
                        response: metadataError
                    });
                }

                let parsedResponse = JSON.parse(metadataResponse.body);
                if (parsedResponse.error) {
                    return res.status(500).render('pages/error', {
                        errorCode: parsedResponse.error.code,
                        errorStatus: parsedResponse.error.status,
                        errorMessage: parsedResponse.error.message,
                        response: JSON.stringify(parsedResponse, null, 4)
                    });
                }

                let shareLink = parsedResponse.shareLink;
                res.status(200).render('pages/success', {
                    status: parsedResponse.mapsPublishStatus,
                    shareLink: shareLink,
                    response: JSON.stringify(parsedResponse, null, 4)
                });
            });
        });
    });
});

app.get('/auth', function (req, res) {
    const options = {
        method: 'POST',
        url: `https://www.googleapis.com/oauth2/v4/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=authorization_code&code=${req.query["code"]}&redirect_uri=${full_url}/auth/&scope=https://www.googleapis.com/auth/streetviewpublish`,
    };

    request(options, function (error, response) {
        if (error) {
            console.log(error);
            return res.send("Error: Check console");
        }

        let body = JSON.parse(response.body);
        if (body.error || !body.access_token) {
            return res.redirect('/');
        }

        res.cookie('oauth', body.access_token, {
            maxAge: body.expires_in * 1000,
            httpOnly: true
        });
        res.render('pages/upload');
    });
});

app.listen(port);
