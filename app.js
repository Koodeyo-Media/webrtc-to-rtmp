const { spawn } = require('child_process');
const MediaServer = require('medooze-media-server');
const { SDPInfo, MediaInfo, CodecInfo } = require('semantic-sdp');
const internalIp = require('internal-ip');
const randomInt = require('random-int');
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const uuid = require('uuid');
const port = process.env.PORT || 3000;
const sessions = new Map();
// Init MediaServer
const ip = process.env.IP_ADDRESS || internalIp.v4.sync();
const endpoint = MediaServer.createEndpoint(ip);
const capabilities = MediaServer.getDefaultCapabilities();
// Limit MediaServer video capabilities to H264 only
capabilities.video.codecs = ['h264;packetization-mode=1']
app.use(express.static('public'));

class WEBRTCRTMP { 
    constructor(ws, rtmpAddress) {
        this.ws = ws;
        this.rtmpAddress = rtmpAddress;
        this.id = uuid.v4()
        this.ffmpegProcess;
        this.gstreamerProcess;
        this.incomingStream;
        this.streamer;
        this.streamerSessionAudio;
        this.streamerSessionVideo;
        this.STREAMER_REMOTE_IP = '127.0.0.1';

        this.STREAMER_AUDIO_PORT = 49170 + (randomInt(10, 100) * 2);
        this.STREAMER_AUDIO_CODEC = 'opus';
        this.STREAMER_AUDIO_PAYLOAD = 109;
        this.STREAMER_AUDIO_CLOCKRATE = 48000;
        this.STREAMER_AUDIO_CHANNELS = 2;

        this.STREAMER_VIDEO_PORT = 55000 + (randomInt(10, 100) * 2);
        this.STREAMER_VIDEO_CODEC = 'h264';
        this.STREAMER_VIDEO_PAYLOAD = 96;
        this.STREAMER_VIDEO_CLOCKRATE = 90000;
    }
    
    // Function creates new Streamer and starts streaming.
    // Will be called when external process is ready to receive streams.
    startStreamer() {
        // Create new Streamer
        this.streamer = MediaServer.createStreamer();
    
        // Audio stream
    
        // Start audio stream
        const audio = new MediaInfo('audio', 'audio');
        audio.addCodec(new CodecInfo(this.STREAMER_AUDIO_CODEC, this.STREAMER_AUDIO_PAYLOAD));
    
        // Create StreamerSession for audio
        this.streamerSessionAudio = this.streamer.createSession(audio, {
            remote: {
                ip: this.STREAMER_REMOTE_IP,
                port: this.STREAMER_AUDIO_PORT,
            },
        });
    
        // Attach audio track from incoming stream to streamer session
        this.streamerSessionAudio
        .getOutgoingStreamTrack()
        .attachTo(this.incomingStream.getAudioTracks()[0]);
    
        // Video stream
    
        // Create codec description
        const video = new MediaInfo('video', 'video');
        video.addCodec(new CodecInfo(this.STREAMER_VIDEO_CODEC, this.STREAMER_VIDEO_PAYLOAD));
    
        // Create StreamerSession for video
        this.streamerSessionVideo = this.streamer.createSession(video, {
            remote: {
                ip: this.STREAMER_REMOTE_IP,
                port: this.STREAMER_VIDEO_PORT,
            }
        });
    
        // Attach video track from incoming stream to streamer session
        this.streamerSessionVideo
        .getOutgoingStreamTrack()
        .attachTo(this.incomingStream.getVideoTracks()[0]);
    }

    run(sdpStr) {
        const offer = SDPInfo.process(sdpStr);
        const transport = endpoint.createTransport(offer);
        transport.setRemoteProperties(offer);
      
        const answer = offer.answer({
          dtls: transport.getLocalDTLSInfo(),
          ice: transport.getLocalICEInfo(),
          candidates: endpoint.getLocalCandidates(),
          capabilities,
        });
      
        transport.setLocalProperties(answer);
        this.incomingStream = transport.createIncomingStream(offer.getFirstStream());
      
        const outgoingStream = transport.createOutgoingStream({
          audio: true,
          video: true
        });
      
        outgoingStream.attachTo(this.incomingStream);
        answer.addStream(outgoingStream.getStreamInfo());
      
        this.sendJson({
          type: 'answer',
          sdp: answer.unify().toString(),
        });

        this.push();
    } 

    push() {
        // Spawn FFMpeg process which will listen to RTP stream from MediaServer.
        // FFMpeg is set up to mux H264 video stream with AAC audio stream into a single MP4 file.
        // Since WebRTC normally uses Opus as audio codec, it will be transcoded into AAC by FFMpeg.
        this.ffmpegProcess = spawn(
            'ffmpeg', [
                '-protocol_whitelist', 'pipe,rtp,udp',
                '-i', '-',
                '-fflags', '+genpts+igndts+flush_packets+discardcorrupt',
                '-c:a', 'aac',
                '-c:v', 'libx264',
                '-frame_drop_threshold', '1.0',
                '-preset', 'ultrafast',
                '-f', 'flv', this.rtmpAddress,
                '-async', '1',
                '-vsync', '2'
            ]
            .join(' ')
            .split(' ')
        );


        // Feed SDP into FFMpeg sdtin
        this.ffmpegProcess.stdin.write(this.sdp);
        this.ffmpegProcess.stdin.end();

        console.log(`FFMpeg started for session ${this.id}`);

        // Wait for FFMpeg to initialize and start Streamer
        this.ffmpegProcess.stderr.on('data', (chunk) => {
            chunk
            .toString()
            .split(/\r?\n/g)
            .forEach((line) => {
                if (line.indexOf('ffmpeg version') !== -1) {
                    this.startStreamer();
                    console.log(`ffmpeg push started for session ${this.id}`);
                }
            });
        });

        this.ffmpegProcess.on('exit', (code, signal) => {
            console.log(`FFMpeg stopped with exit code ${code} (${signal})`);
            // Stop streamer
            this.streamerSessionVideo.stop();
            this.streamerSessionAudio.stop();
            this.streamer.stop();
            this.streamer = null;
            console.log('Streamer stopped');
        });

        this.ffmpegProcess.on('error', (err) => {
            console.error('FFMpeg error:', err);
        });

        this.ffmpegProcess.stdout.pipe(process.stdout);
        this.ffmpegProcess.stderr.pipe(process.stderr);
    }

    get sdp() {
        // Create an SDP description RTP streams
        return `c=IN IP4 ${this.STREAMER_REMOTE_IP}
            s=Koodeyo Media
            a=fmtp:96 packetization-mode=1; profile-level-id=42C01F
            m=audio ${this.STREAMER_AUDIO_PORT} RTP ${this.STREAMER_AUDIO_PAYLOAD}
            a=rtpmap:${this.STREAMER_AUDIO_PAYLOAD} ${this.STREAMER_AUDIO_CODEC}/${this.STREAMER_AUDIO_CLOCKRATE}/${this.STREAMER_AUDIO_CHANNELS}
            m=video ${this.STREAMER_VIDEO_PORT} RTP ${this.STREAMER_VIDEO_PAYLOAD}
            a=rtpmap:${this.STREAMER_VIDEO_PAYLOAD} ${this.STREAMER_VIDEO_CODEC}/${this.STREAMER_VIDEO_CLOCKRATE}`;

    }

    sendJson(msg) {
        this.ws.send(JSON.stringify(msg));
    }

    stop(){
        if(this.ffmpegProcess) {
            this.ffmpegProcess.kill('SIGINT');
            this.ffmpegProcess = null;
            console.log('FFMpeg stopped');
        }
        this.sendJson({
            type: "alert",
            message: "Stopped"
        })
    }
}

wss.on('connection', function connection(ws, req) {
    ws.sid = uuid.v4();
    ws.on('message', function(message) {
        let msg = JSON.parse(message);
        if(msg.start) {
            let session = sessions.get(ws.sid);
            if(session) {
                session.stop();
                sessions.delete(ws.sid)
            }
            session = new WEBRTCRTMP(ws, msg.rtmpAddress);
            sessions.set(ws.sid, session);
            if(/[rtmp|rtmps]:\/\//.test(msg.rtmpAddress)) {
                return session.sendJson({
                    type: "alert",
                    message: "Invalid rtmp endpoint"
                });
            }
            session.run(msg.sdp); 
        } else if(msg.push) {
            let session = sessions.get(ws.sid);
            session.push();
        } else if(msg.stop) {
            let session = sessions.get(ws.sid);
            session.stop();
        }
    });

    ws.on('close', function(reasonCode, description) {
        let session = sessions.get(ws.sid);
        if(session){
            session.stop();
            sessions.delete(ws.sid)
        }
    });
});

const listener = server.listen(port, () => {
    console.log(`Listening on ${ip} port ${listener.address().port}`);
});

process.on('uncaughtException', function (error) {});