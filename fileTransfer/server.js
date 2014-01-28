var io = require('socket.io').listen(8080, {log: false});
var rooms = {};
var leaderRoom = {};
io.sockets.on('connection', function (socket) {
  socket.on('ice', function (data) {
    if(rooms[data.roomId]){
      if(socket.id != rooms[data.roomId].leader){
        data.socket = socket.id;
        io.sockets.socket(rooms[data.roomId].leader).emit('ice', data);
      }else{
        var target = data.socket;
        delete data.socket;
        io.sockets.socket(target).emit('ice', data);
      }
    }
  });
  socket.on('sdp', function (data) {
    if(rooms[data.roomId]){
      if(socket.id != rooms[data.roomId].leader){
        data.socket = socket.id;
        io.sockets.socket(rooms[data.roomId].leader).emit('sdp', data);
      }else{
        var target = data.socket;
        delete data.socket;
        io.sockets.socket(target).emit('sdp', data);
      }
    }
  });
  socket.on("createRoom", function(data) {
  	if(!rooms[data.roomId]){
      console.log(data.fileInfo);
  		rooms[data.roomId] = {leader: socket.id, slaves: []};
      leaderRoom[socket.id] = data.roomId;
  		console.log('Room ' + data.roomId + ' created');
  	}
  });
  socket.on("joinRoom", function(data) {
  	if(rooms[data.roomId]){
  		// rooms[data.roomId].slaves.push(socket.id);
  		console.log('Joined room ' + data.roomId);
      io.sockets.socket(rooms[data.roomId].leader).emit('newSlave', {"socket": socket.id});
      socket.emit('fileInfo', rooms[data.roomId].fileInfo);
  	}
  });
  socket.on("disconnect", function(){
    if(leaderRoom[socket.id]){
      console.log('room '+leaderRoom[socket.id]+' deleted');
      delete rooms[leaderRoom[socket.id]];
      delete leaderRoom[socket.id];
    }
  });
});