
let ws = new WebSocket((window.location.protocol === 'http:' ? 'ws' : 'wss') + '://' + window.location.host);

document.getElementById('startBtn').addEventListener('click', () => {
    const videoLoopbackElement = document.getElementById('video-loopback');
    const stopBtn = document.getElementById('stopBtn');

    navigator.mediaDevices
        .getUserMedia({
            audio: true,
            video: true
        })
        .then((cameraStream) => {
            videoLoopbackElement.srcObject = cameraStream;
            
            const pc = new RTCPeerConnection({
                sdpSemantics: 'unified-plan',
            });
    
            cameraStream.getTracks().forEach((track) =>
                pc.addTransceiver(track, {
                    direction: 'sendrecv',
                    streams: [cameraStream]
                })
            );
    
            pc.createOffer()
                .then((offer) => pc.setLocalDescription(offer))
                .then(() => {
                    sendJson({
                        start: true,
                        rtmpAddress: document.getElementById('rtmpAddress').value,
                        sdp: pc.localDescription.sdp,
                    })
                })
            .catch((err) => console.error(err));
    
            stopBtn.addEventListener('click', () => sendJson({ stop: true }));
    
            ws.onmessage = function({ data }) {
                let msg = JSON.parse(data);
                if(msg.type ==='alert') {
                    return alert(msg.message);
                }
                pc.setRemoteDescription(msg);
                sendJson({ push: true })
            };
    
            function sendJson(data) {
                ws.send(JSON.stringify(data));
            }
        });
});