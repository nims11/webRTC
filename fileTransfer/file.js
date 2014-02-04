/*
    Things to implement 
                    - Stopping download
                    - Removing a file from list
                    - purging a file from memory
                    - Redownload
                    - Checksum

                    - Separate file transfer JS and UI JS
                    - Remove JQuery and Bootstrap. very bloat, not wow.
*/

/*
    $fileLeader and $fileClient -   Template for filelist items for
                                    Room Leader and Clients, respectively.
*/
var $uploadField, $fileList, $fileLeader, $fileClient;
$(document).ready(function(){
    $uploadField = $(document.uploadForm.uploadField);
    $fileList = $('#fileList');
    $fileLeader = $('#templates .fileLeader');
    $fileClient = $('#templates .fileClient');
});


var socket = io.connect('http://'+window.location.hostname+':8080');
navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
var is_firefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1;

var pc; // Used if the client isn't an initiator
var peers = {}; //  Used to store clients connecting to the initator
var isLeader;   // If the client is the initiator
var roomId;
var files = {}; // List of files. Complete in case of Room leader
var fileIds = 0;    // Fileid count

//Need to thoroughly test delay and tries mechanism.
var delay = 5, originalDelay = delay, diffDelay=10;   // Minimum delay between two responses.
var minDelay = 5;
var maxDelay = 1000;
var tryLimit = 15;  // Max number of attempts before failing


// {fileId: ..., chunkId: ...}
var reqQueue = [];
// {fileId: ..., chunkId: ..., peerId}
var responseQueue = [];

//Delay Mechanism for increasing and decreasing delay
function incDelay(){
    console.log("Increasing Delay");
    delay = Math.min(delay+diffDelay, maxDelay);
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
            if(!isLeader)
                console.log(event.data.length);
            var endmarkerStr = '"endmarker":1}';
            var endmarker = event.data.indexOf(endmarkerStr);
            var data;
            if(endmarker != -1){
                var JSONData = event.data.substr(0, endmarkerStr.length+endmarker);
                try{
                    data = JSON.parse(JSONData);
                    data.fileChunk = event.data.substr(JSONData.length);
                }catch(e){
                    data = JSON.parse(event.data);
                }
            }
            else
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
        return 5000;
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

// When the leader receives a request, add it to the response queue
function handleRequest(request, pc){
    file = files[request.fileId];
    if(!file || 
        file.totChunk <= request.chunkId ||
        request.chunkId < 0
        )
        return false;
    responseQueue.push({fileId: request.fileId, chunkId: request.chunkId, peerId: pc.socket});

    // Start processing the response queue if it was already empty
    if(responseQueue.length == 1)
        processResponseQueue();
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
    processReqQueue();
}
function processReqQueue(tries){
    if(typeof(tries)==='undefined')
        tries = tryLimit;
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
    if(typeof(tries)==='undefined')
        tries = tryLimit;

    // If the request is invalid due the peer no longer existing, remove it
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
                var fileChunkStr = String.fromCharCode.apply(null, new Uint8Array(fileChunk));

                var data = {type: 'responseChunk', fileId: res.fileId, chunkId: chunkId, endmarker:1};
                pc.channel.send(JSON.stringify(data)+fileChunkStr);
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
    
    // If response Queue is filled, schedule next response processing
    if(responseQueue.length > 0)
        setTimeout(getFunc(processResponseQueue, tryLimit), delay);
}
function updateProgress($target){
    var intervalId;
    var fileId = $target.data('fileId');
    var file = files[fileId];
    var $progressBar = $target.find('.progress-bar');
    var $progressText = $target.find('.progressText');
    var startTime = new Date().getTime();
    function update(){
        var progress = +(file.completed/file.totChunk*100).toFixed(1);
        $progressBar.css('width', progress+'%');
        $progressBar.attr('aria-valuenow', progress);
        $progressText.text(progress+"%");

        if(file.completed == file.totChunk){
            clearInterval(intervalId);

            // Will give really low value for small files due to the 500 ms offset at which it runs
            // need to shift it to other function
            var timeElapsed = (new Date().getTime() - startTime)/1000;
            var bytesPerSec = file.file.size/timeElapsed;
            $progressText.text('Completed in ' + (+timeElapsed.toFixed(1)) + 's ('+getSuitableSizeUnit(bytesPerSec)+'ps)');

            $saveLink = $target.find('.glyphicon-floppy-save');
            enableAction($saveLink);
            disableAction($target.find('.glyphicon-stop'))
            $saveLink = $saveLink.parent();
            var b = new Blob(file.arraybuf);
            var url = URL.createObjectURL(b);
            $saveLink.attr('href', url);
            $saveLink.attr('download', file.file.name);

        }
    }
    intervalId = setInterval(update, 500);
}
function startDownload(evt){
    console.log('Starting Download');
    $target = $(evt.target).closest('.row');
    fileId = $target.data('fileId');
    var file = files[fileId];
    var chunks = file.totChunk;
    for(var i = 0;i<chunks;i++)
        reqQueue.push({fileId: fileId, chunkId: i});

    updateProgress($target);
    processReqQueue(tryLimit);
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
function disableAction($target){
    $target.removeClass('active');
    $target.parent().off('click');
    $target.parent().attr('href', null);
}
function enableAction($target, func){
    $target.addClass('active');
    $target.parent().on('click', func);
    $target.parent().attr('href', '');
}
function addFileToList(data){
    $newFileDiv = $fileClient.clone();
    $newFileDiv.data('fileId', data.fileId);
    $newFileDiv.children('.fileName').text(data.name);
    $newFileDiv.children('.fileSize').text(getSuitableSizeUnit(data.size));

    // Enable Download Button
    $downBut = $newFileDiv.find('.glyphicon-save');
    enableAction($downBut, function (evt){
        evt.stopPropagation();
        evt.preventDefault();

        $target = $(evt.target).parent().parent();
        disableAction($target.find('.glyphicon-save'));
        enableAction($target.find('.glyphicon-stop'));

        startDownload(evt);
        return false;
    });

    $fileList.append($newFileDiv);
    delete data['type'];
    files[data.fileId] = {file: data, 
        arraybuf: new Array(noOfChunks(data.size, pc.chunkSize)), 
        totChunk: noOfChunks(data.size, pc.chunkSize),
        completed: 0
    };
}
function getSuitableSizeUnit(bytes){
    if(bytes<1000){
        return bytes+"B";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"KB";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"MB";
    }
    bytes /= 1000;
    if(bytes<1000){
        return (+bytes.toFixed(1))+"GB";
    }
    return "???B";
}
function addFiles(fs){
    for(var i = 0; i < fs.length; i++){
        var f = fs[i];
        var reader = new FileReader();
        reader.onload = (function(f){
            return function(e){
                files[fileIds] = {file: f, arraybuf: e.target.result};

                $newFileDiv = $fileLeader.clone();
                $newFileDiv.data('fileId', fileIds);
                $newFileDiv.children('.fileName').text(f.name);
                $newFileDiv.children('.fileSize').text(getSuitableSizeUnit(f.size));

                $fileList.append($newFileDiv);

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
        $uploadField.on('change', function(){
            var fs = $uploadField[0].files;
            addFiles(fs);
        });
        processResponseQueue(tryLimit);
    }else {
        $("#uploadArea").hide();
        joinRoom();
    }
}