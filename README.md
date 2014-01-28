# WebRTC Playground
### Prerequisites
-   node.js
-   socket.io   (npm install socket.io)
-   Any HTTP server     (python -m SimpleHTTPServer)

### One to one Video Chat
A trivial webrtc demo for one to one Video Chat. Works on all latest Firefox and Chrome/Chromium (Including cross browser).

### Multi Client Text Chat
A proper room based chat system using RTCDataChannel. Works on all latest Firefox and Chrome/Chromium but currently no cross browser supported. That means all people in a room must be using the same browser. This is due to the current limitation of RTCDataChannel implementations in browsers. Chrome 31+ and Firefox 27+ are said to be compatible, but will look into them once Firefox 27 comes out of beta.

One-to-Many architecture is used. The Room leader is responsible for acting as a bridge and act as a psuedo chat server. Will write more on it later.

To run
```
node multitxt.js
```
And open the multitxt.html in browser. (Via the HTTP server, not directly from the file manager)

### File Sharing
Transfer files using RTC Data Channels. File is transferred through chunking (Performance issues and Chrome limitations). The client requests for chunk and the serving peer responds with the actual chunk. Optimization related to chunk size and delay needed to be done. The serving peer uses a delay to process the queue of requests. Will try implementing with 3-way handshaking. Will write more on it later.

## Minor Improvements
-   RTCDataChannel cross browser interop
-   Analyzing many-to-many architecture for Multi Client Text Chat

## Further Projects
-   Integrate Video and Text Chat into multi chat with Video and Text. Possible issues may include architecture to use. One-to-Many may lead to more latency as well as security issues.
-   Distributed File Sharing Network. Something similar to BitTorrent.
