const express = require("express");
const app = express();
const server = require("http").Server(app);
const webrtc = require("wrtc");
const Recorder = require('./record');

const io = require("socket.io")(server, {
  cors: {
    origin: '*'
  }
});

app.set("view engine", "ejs");
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.render("publisher");
});

io.on("connection", (socket) => {
  console.log('socket', socket.id)

  socket.on("sdpOffer", async (sdpOffer) => {
    const peer = new webrtc.RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.stunprotocol.org"
        }
      ]
    });

    function handleTrackEvent(e, peer) {
      console.log("peer stream", e)
    };

    peer.ontrack = (e) => handleTrackEvent(e, peer);

    const desc = new webrtc.RTCSessionDescription(sdpOffer);
    await peer.setRemoteDescription(desc);
    Recorder.beforeOffer(peer);

    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    socket.emit('sdpAnswer', peer.localDescription);
  });

  socket.on("ffmpeg-start", () => {
    console.log("start process", socket.sdpOffer)
  });

  socket.on("ffmpeg-stop", (message) => {
    socket.emit('stopped');
  })
});

server.listen(process.env.PORT || 3000);
