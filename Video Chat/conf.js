var io = require('socket.io').listen(8080);
var rooms = {};
io.sockets.on('connection', function (socket) {
  socket.on('ice', function (data) {
    socket.broadcast.emit('ice', data);
  });
  socket.on('sdp', function (data) {
    socket.broadcast.emit('sdp', data);
  });
  socket.on("createRoom", function(data) {
  	if(!rooms[data.roomId]){
  		rooms[data.roomId] = {leader: socket, slaves: []};
  		console.log('Room ' + data.roomId + ' created');
  	}
  });
  socket.on("joinRoom", function(data) {
  	if(rooms[data.roomId]){
  		rooms[data.roomId].slaves.push(socket);
  		console.log('Someone Joined room ' + data.roomId);
  		rooms[data.roomId].leader.emit();
  	}
  });
});
