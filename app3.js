const express = require("express");
const app = express();
const server = require("http").Server(app);

const { spawn } = require('child_process');
const MediaServer = require('medooze-media-server');
const { SDPInfo, MediaInfo, CodecInfo } = require('semantic-sdp');
const internalIp = require('internal-ip');

// Init MediaServer
const ip = process.env.IP_ADDRESS || internalIp.v4.sync();
const endpoint = MediaServer.createEndpoint(ip);

const capabilities = MediaServer.getDefaultCapabilities();

// Limit MediaServer video capabilities to H264 only
capabilities.video.codecs = ['h264;packetization-mode=1'];

// Variable for storing ref to incoming stream
let incomingStream;

// Variables for storing ref to working processes
let gstreamerProcess;
let ffmpegProcess;

// Variables for storing ref to Streamer instance and its sessions
let streamer;
let streamerSessionAudio;
let streamerSessionVideo;

// Streaming parameters
const STREAMER_REMOTE_IP = '127.0.0.1';

const STREAMER_AUDIO_PORT = 5004;
const STREAMER_AUDIO_CODEC = 'opus';
const STREAMER_AUDIO_PAYLOAD = 109;
const STREAMER_AUDIO_CLOCKRATE = 48000;
const STREAMER_AUDIO_CHANNELS = 2;

const STREAMER_VIDEO_PORT = 5006;
const STREAMER_VIDEO_CODEC = 'h264';
const STREAMER_VIDEO_PAYLOAD = 96;
const STREAMER_VIDEO_CLOCKRATE = 90000;

// Function creates new Streamer and starts streaming.
// Will be called when external process is ready to receive streams.
const startStreamer = () => {
  // Create new Streamer
  streamer = MediaServer.createStreamer();

  // Audio stream

  // Start audio stream
  const audio = new MediaInfo('audio', 'audio');
  audio.addCodec(new CodecInfo(STREAMER_AUDIO_CODEC, STREAMER_AUDIO_PAYLOAD));

  // Create StreamerSession for audio
  streamerSessionAudio = streamer.createSession(audio, {
    remote: {
      ip: STREAMER_REMOTE_IP,
      port: STREAMER_AUDIO_PORT,
    },
  });

  // Attach audio track from incoming stream to streamer session
  streamerSessionAudio
    .getOutgoingStreamTrack()
    .attachTo(incomingStream.getAudioTracks()[0]);

  // Video stream

  // Create codec description
  const video = new MediaInfo('video', 'video');
  video.addCodec(new CodecInfo(STREAMER_VIDEO_CODEC, STREAMER_VIDEO_PAYLOAD));

  // Create StreamerSession for video
  streamerSessionVideo = streamer.createSession(video, {
    remote: {
      ip: STREAMER_REMOTE_IP,
      port: STREAMER_VIDEO_PORT,
    },
  });

  // Attach video track from incoming stream to streamer session
  streamerSessionVideo
    .getOutgoingStreamTrack()
    .attachTo(incomingStream.getVideoTracks()[0]);
};

const io = require("socket.io")(server, {
  cors: {
    origin: '*'
  }
});

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.static("media"));

app.get("/", (req, res) => {
  res.render("publisher");
});

io.on("connection", (socket) => {
  console.log('socket', socket.id)

  socket.on("sdpOffer", (sdpOffer) => {
    const offer = SDPInfo.process(sdpOffer.sdp);

    const transport = endpoint.createTransport(offer);
    transport.setRemoteProperties(offer);
  
    const answer = offer.answer({
      dtls: transport.getLocalDTLSInfo(),
      ice: transport.getLocalICEInfo(),
      candidates: endpoint.getLocalCandidates(),
      capabilities,
    });
    
    transport.setLocalProperties(answer);
  
    incomingStream = transport.createIncomingStream(offer.getFirstStream());
  
    const outgoingStream = transport.createOutgoingStream({
      audio: true,
      video: true,
    });

    outgoingStream.attachTo(incomingStream);
    answer.addStream(outgoingStream.getStreamInfo());  

    socket.emit('sdpAnswer', {
      type: 'answer',
      sdp: answer.unify().toString(),
    });
  });

  socket.on("ffmpeg-start", (message) => {
    // If there is another process running, do nothing.
    if (streamer) {
      return;
    }

    // Spawn FFMpeg process which will listen to RTP stream from MediaServer.
    // FFMpeg is set up to mux H264 video stream with AAC audio stream into a single MP4 file.
    // Since WebRTC normally uses Opus as audio codec, it will be transcoded into AAC by FFMpeg.
    ffmpegProcess = spawn(
      'ffmpeg',
      [
        '-protocol_whitelist pipe,rtp,udp',
        `-i -`,
        // '-fflags',
        // '+genpts',
        '-c:a aac',
        '-c:v copy',
        // '-flags',
        // '+global_header',
        '-f mp4',
        '-y',
        `${Date.now()}.mp4`,
      ]
        .join(' ')
        .split(' ')
    );

    // Create an SDP description RTP streams
    const inputSDP = `c=IN IP4 ${STREAMER_REMOTE_IP}
      m=audio ${STREAMER_AUDIO_PORT} RTP ${STREAMER_AUDIO_PAYLOAD}
      a=rtpmap:${STREAMER_AUDIO_PAYLOAD} ${STREAMER_AUDIO_CODEC}/${STREAMER_AUDIO_CLOCKRATE}/${STREAMER_AUDIO_CHANNELS}
      m=video ${STREAMER_VIDEO_PORT} RTP ${STREAMER_VIDEO_PAYLOAD}
      a=rtpmap:${STREAMER_VIDEO_PAYLOAD} ${STREAMER_VIDEO_CODEC}/${STREAMER_VIDEO_CLOCKRATE}`;

    // Feed SDP into FFMpeg sdtin
    ffmpegProcess.stdin.write(inputSDP);
    ffmpegProcess.stdin.end();

    console.log('FFMpeg started');

    // Wait for FFMpeg to initialize and start Streamer
    ffmpegProcess.stderr.on('data', (chunk) => {
      chunk
        .toString()
        .split(/\r?\n/g)
        .forEach((line) => {
          if (line.indexOf('ffmpeg version') !== -1) {
            startStreamer();
            console.log('FFMPeg recording started');
            socket.emit('started');
          }
        });
    });

    ffmpegProcess.on('exit', (code, signal) => {
      console.log(`FFMpeg stopped with exit code ${code} (${signal})`);

      // Stop streamer
      streamerSessionVideo.stop();
      streamerSessionAudio.stop();
      streamer.stop();
      streamer = null;

      console.log('Streamer stopped');
      socket.emit('stopped');
    });

    ffmpegProcess.on('error', (err) => {
      console.error('FFMpeg error:', err);
    });

    ffmpegProcess.stdout.pipe(process.stdout);
    ffmpegProcess.stderr.pipe(process.stderr);
  });

  socket.on("ffmpeg-stop", (message) => {
    if (!ffmpegProcess) {
      return;
    }
  
    ffmpegProcess.kill('SIGINT');
    ffmpegProcess = null;
  
    console.log('FFMpeg stopped');
    socket.emit('stopped');
  })
});

server.listen(process.env.PORT || 3000);
