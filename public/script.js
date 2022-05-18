const socket = io("/");
const videoGrid = document.getElementById("video-grid");
const myVideo = document.createElement("video");
const videoLoopbackElement = document.getElementById('video-loopback');
const moreOptions = document.querySelector("#moreOptions");
const backBtn = document.querySelector(".header__back");

backBtn.addEventListener("click", () => {
  document.querySelector(".main__left").style.display = "flex";
  document.querySelector(".main__left").style.flex = "1";
  document.querySelector(".main__right").style.display = "none";
  document.querySelector(".header__back").style.display = "none";
});

moreOptions.addEventListener("click", () => {
  document.querySelector(".main__right").style.display = "flex";
  document.querySelector(".main__right").style.flex = "1";
  document.querySelector(".main__left").style.display = "none";
  document.querySelector(".header__back").style.display = "block";
});

let myVideoStream;

const peer = new RTCPeerConnection({
  sdpSemantics: 'unified-plan'
});

navigator.mediaDevices
.getUserMedia({
  audio: true,
  video: true,
})
.then((cameraStream) => {
  myVideoStream = cameraStream;
  videoLoopbackElement.srcObject = cameraStream;

  cameraStream.getTracks().forEach((track) =>
    peer.addTransceiver(track, {
      direction: 'sendrecv',
      streams: [cameraStream],
    })
  );
});


const goLive = document.querySelector("#goLive");
const muteButton = document.querySelector("#muteButton");
const stopVideo = document.querySelector("#stopVideo");

muteButton.addEventListener("click", () => {
  const enabled = myVideoStream.getAudioTracks()[0].enabled;
  if (enabled) {
    myVideoStream.getAudioTracks()[0].enabled = false;
    html = `<i class="fas fa-microphone-slash"></i>`;
    muteButton.classList.toggle("background__red");
    muteButton.innerHTML = html;
  } else {
    myVideoStream.getAudioTracks()[0].enabled = true;
    html = `<i class="fas fa-microphone"></i>`;
    muteButton.classList.toggle("background__red");
    muteButton.innerHTML = html;
  }
});

stopVideo.addEventListener("click", () => {
  const enabled = myVideoStream.getVideoTracks()[0].enabled;
  if (enabled) {
    myVideoStream.getVideoTracks()[0].enabled = false;
    html = `<i class="fas fa-video-slash"></i>`;
    stopVideo.classList.toggle("background__red");
    stopVideo.innerHTML = html;
  } else {
    myVideoStream.getVideoTracks()[0].enabled = true;
    html = `<i class="fas fa-video"></i>`;
    stopVideo.classList.toggle("background__red");
    stopVideo.innerHTML = html;
  }
});

let publishing = false;

socket.on('started', () => {
  goLive.innerHTML = "Stop";
  publishing = true;
});

socket.on('stopped', () => {
  goLive.innerHTML = "GO Live";
  publishing = false;
});

socket.on('sdpAnswer', (sdpAnswer) => {
  console.log('sdpAnswer', sdpAnswer)
  peer.setRemoteDescription(sdpAnswer).then(() => {
    socket.emit("ffmpeg-start");
  })
  .catch((err) => console.error(err));
});

goLive.addEventListener("click", (e) => {
  if(!publishing) {
    peer.createOffer()
    .then((offer) => peer.setLocalDescription(offer))
    .then(() => {
      socket.emit('sdpOffer', peer.localDescription);
    })
  } else {
    socket.emit('ffmpeg-stop');
  }
});
