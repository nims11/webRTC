var socket = io.connect('http://'+window.location.hostname+':8080');
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var is_firefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

var pc; // Used if the client isn't an initiator
var peers = {}; //  Used to store clients connecting to the initator
var isLeader;   // If the client is the initiator
var roomId;
var files = {}; // List of files. Complete in case of Room leader
var fileIds = 0;
var delay = 100, originalDelay = delay, diffDelay=10;   // Minimum delay between two responses.
var minDelay = 10;
var maxDelay = 1000;
var tryLimit = 10;  // Max number of attempts before failing

var intervalId;
var time;

// {fileId: ..., chunkId: ...}
var reqQueue = [];
// {fileId: ..., chunkId: ..., peerId}
var responseQueue = [];

function incDelay(){
    if(delay + diffDelay <= maxDelay){
        console.log("Increasing Delay");
        delay += diffDelay;
    }
}
function decDelay(){
    if(delay - diffDelay >= minDelay){
        delay -= diffDelay;
    }
}

function newPeer(sock){   // Arguments applicable only for the leader
    var pc = new RTCPeerConnection(pc_config, {optional: [{DtlsSrtpKeyAgreement:true}]});
    var pc_config = {"iceServers": [{"url": "stun:stun.l.google.com:19302"}]};
    pc.isLeader = isLeader;
    pc.socket = sock;   // Session id with the socket.io instance of the other peer
    var mediaConstraints = {};
    pc.onicecandidate = function (evt) {
        console.log('ice');
        socket.emit('ice', { "candidate": evt.candidate, "roomId": roomId, "socket": pc.socket});
    };
    pc.answer = function (){
        pc.createAnswer(gotDescription, function (event){}, mediaConstraints);
    }
    pc.offer = function (){
        pc.createOffer(gotDescription, function (event){}, mediaConstraints);
    }

    function handleDisconnect(){    // Detects when a peer isn't reachable any longer
        if(pc.iceConnectionState == 'disconnected' || pc.iceConnectionState == 'closed'){
            if(isLeader){
                delete peers[pc.socket];
                console.log('A user has left')
            }else{
                console.log('Lost Connection to the leader')
            }
        }
    }

    if(isLeader) {  // Create a channel if initiator
        pc.channel = pc.createDataChannel("sendDataChannel");
        setupChannel(pc.channel);
        pc.channel.onopen = function(){
            console.log('User Joined');
            pc.oniceconnectionstatechange = handleDisconnect;
            sendFileInfoToNewUser(pc);
        }
    } else{ // Else wait for a channel from the initiator
        pc.ondatachannel = function(event) {
            console.log('connected channel');
            pc.channel = event.channel;
            setupChannel(pc.channel);
            pc.oniceconnectionstatechange = handleDisconnect;
        };
    }

    function setupChannel(channel){
        var x = 0;
        channel.onmessage = function(event){
//            if(isLeader)
            console.log(event.data.length);
            // if(x < 5)
            //     console.log(event.data);
            // else{
            //     reqQueue = [];
            // }
            // x++;
            data = JSON.parse(event.data);
            if(isLeader){
                if(data.type == 'reqChunk')
                    handleRequest(data, pc);
            }else{
                if(data.type == 'newFile')
                    addFileToList(data);
                else if(data.type == 'responseChunk')
                    handleResponse(data);
            }
        };
    }
    function gotDescription (desc){
        pc.setLocalDescription(desc);
        socket.emit('sdp', { "sdp": desc , "roomId": roomId, "socket": pc.socket});
    }
    pc.chunkSize = getChunkSize();
    function getChunkSize(){
        // return 100;
        return 20000;
    }
    return pc;
}
function getFunc(func, arg){
    return function(){
        func(arg);
    }
}
function noOfChunks(size, chunkSize){
    return Math.ceil(size/chunkSize);
}
function handleRequest(request, pc){
    file = files[request.fileId];
    if(!file || 
        file.totChunk <= request.chunkId ||
        request.chunkId < 0
        )
        return false;
    responseQueue.push({fileId: request.fileId, chunkId: request.chunkId, peerId: pc.socket});
}
function handleResponse(response){
    if(reqQueue.length == 0 || reqQueue[0].chunkId != response.chunkId || reqQueue[0].fileId != response.fileId)
        return false;
    var file = files[response.fileId];
    file.arraybuf[response.chunkId] = new ArrayBuffer(response.fileChunk.length);
    var bufView = new Uint8Array(file.arraybuf[response.chunkId]);
    for(var i = 0;i<response.fileChunk.length;i++)
        bufView[i] = response.fileChunk.charCodeAt(i);
    reqQueue.shift();
    file.completed++;
    if(response.chunkId == file.totChunk-1){
        clearInterval(intervalId), console.log(time);
    }
    processReqQueue(tryLimit);
}
function processReqQueue(tries){
    if(reqQueue.length == 0)
        return true;
    if(!tries){
        console.log('Stalling Download, failed');
        return false;
    }
    var req = reqQueue[0];
    try{
        var data = {type: 'reqChunk', fileId: req.fileId, chunkId: req.chunkId};
        pc.channel.send(JSON.stringify(data));
        decDelay();
    }catch(e){
        console.log(e);
        console.log('Failed sending, queued for resending');
        incDelay();
        setTimeout(getFunc(processReqQueue, tries-1), delay);
    }
}
function processResponseQueue(tries){
    while(responseQueue.length > 0 && !peers[responseQueue[0].peerId])
        responseQueue.shift();
    if(responseQueue.length != 0){
        if(!tries){
            console.log('Discarding Chunk: ', responseQueue[0]);
            responseQueue.shift();
        }else{
            try{
                var res = responseQueue[0];
                var pc = peers[res.peerId];
                var chunkSize = pc.chunkSize;
                var chunkId = res.chunkId;
                var fileChunk = files[res.fileId].arraybuf.slice(chunkId*chunkSize, (chunkId+1)*chunkSize);
                console.log("Chunk Length: "+fileChunk.byteLength);
                fileChunkStr = String.fromCharCode.apply(null, new Uint8Array(fileChunk));
                fileChunk = Array.apply(null, new Uint8Array(fileChunk));

                var data = {type: 'responseChunk', fileId: res.fileId, chunkId: chunkId, fileChunk: fileChunkStr};
                pc.channel.send(JSON.stringify(data));
                responseQueue.shift();
                decDelay();
            }catch(e){
                incDelay();
                throw e;
                console.log(e);
                console.log('Failed sending, queued for resending');
                setTimeout(getFunc(processResponseQueue, tries-1), delay);
                return false;
            }
        }
    }
    setTimeout(getFunc(processResponseQueue, tryLimit), delay);
}
function updateProgress($target){
    var intervalId;
    var file = files[$target.data('fileId')];
    function update(){
        var progress = parseInt(file.completed/file.totChunk*1000)/10;
        $target.text(progress.toString()+"%");
        if(file.completed == file.totChunk){
            clearInterval(intervalId);
            var b = new Blob(file.arraybuf);
            var url = URL.createObjectURL(b);
            $target.html('<a href="'+url+'" download="'+file.file.name+'"">Save as</a>');
        }
    }
    intervalId = setInterval(update, 1000);
}
function startDownload(evt){
    console.log('Starting Download');
    evt.stopPropagation();
    evt.preventDefault();
    $target = $(evt.target);
    fileId = $target.data('fileId');
    var file = files[fileId];
    var chunks = file.totChunk;
    for(var i = 0;i<chunks;i++){
        reqQueue.push({fileId: fileId, chunkId: i});
    }
    time = 0;
    if(!intervalId)
        intervalId = setInterval(function(){time++;}, 1000);

    updateProgress($target.parent().children('span'));
    processReqQueue(tryLimit);
    return false;
}

socket.on('ice', function(signal) {
    if(isLeader && (!signal.socket || !peers[signal.socket]))
        return;
    if(!isLeader && !pc)
        pc = newPeer();
    if(signal.candidate == null) {return;}

    if(isLeader)
        peers[signal.socket].addIceCandidate(new RTCIceCandidate(signal.candidate));
    else
        pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
});
socket.on('sdp', function(signal) {
    if(isLeader && (!signal.socket || !peers[signal.socket]))
        return;
    if(!isLeader && !pc)
        pc = newPeer();

    if(!isLeader)
        pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
    else
        peers[signal.socket].setRemoteDescription(new RTCSessionDescription(signal.sdp));
    if(!isLeader)
        pc.answer();
});
socket.on('newSlave', function(data) {
    console.log('new slave');
    peers[data.socket] = newPeer(data.socket, data.nick);
    peers[data.socket].offer();
});


function createRoom(){
    roomId = "";
    while(!roomId.length){
        /*
        Todo: handle roomId clash
        */
        roomId = Math.random().toString(36).substring(2, 7);
    }
    window.location.hash = roomId;
    socket.emit('createRoom', 
        {"roomId": roomId});
    isLeader = true;
}
function joinRoom(){
    roomId = window.location.hash.substring(1);
    /*
    Todo: handle invalid id
    */
    socket.emit('joinRoom', {"roomId": roomId});
    isLeader = false;
    pc = newPeer();
}

var uploadField, $fileList;
$(document).ready(function(){
    uploadField = document.uploadForm.uploadField;
    $fileList = $('#fileList');
});
function sendHighPriorityMsg(data, pc){
    var dataStr = JSON.stringify(data);
    if(!pc){
        for(id in peers){
            peers[id].channel.send(dataStr);
        }
    }else
        pc.channel.send(dataStr);
}
function sendFileInfoToNewUser(pc){
    for(id in files){
        f = files[id].file;
        sendHighPriorityMsg({type: 'newFile', fileId: id, name: f.name, size: f.size}, pc);
    }
}
function addFileToList(data){
    $newli = $('<li id='+'fileNo'+data.fileId+'>'+data.name+'('+data.size+')</li>');
    $newa = $('<a href="#">Download</a>');
    $newSpan = $('<span class="progress"></span>');
    $newa.data('fileId', data.fileId);
    $newSpan.data('fileId', data.fileId);
    $newa.click(startDownload);

    $(fileList).append($newli.append($newa).append($newSpan));
    delete data['type'];
    files[data.fileId] = {file: data, 
        arraybuf: new Array(noOfChunks(data.size, pc.chunkSize)), 
        totChunk: noOfChunks(data.size, pc.chunkSize),
        completed: 0
    };
}
function addFiles(fs){
    for(var i = 0; i < fs.length; i++){
        var f = fs[i];
        var reader = new FileReader();
        reader.onload = (function(f){
            return function(e){
                files[fileIds] = {file: f, arraybuf: e.target.result};
                $(fileList).append('<li id='+'fileNo'+fileIds+'>'+f.name+'</li>');
                sendHighPriorityMsg({type: 'newFile', fileId: fileIds, name: f.name, size: f.size});
                fileIds++;
            }
        })(f);
        reader.readAsArrayBuffer(f);
    }
}
function setup(){
    if(window.location.hash == ""){
        isLeader = true;
        createRoom();
        $(uploadField).on('change', function(){
            console.log(uploadField.files);
            var fs = uploadField.files;
            addFiles(fs);
        });
        processResponseQueue(tryLimit);
    }else {
        $(uploadField).hide();
        joinRoom();
    }
}