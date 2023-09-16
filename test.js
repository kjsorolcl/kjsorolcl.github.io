<script src="https://flashgamehouse.github.io/ruffle.js"></script>
var swfobject = {};

swfobject.embedSWF = function(url, cont, width, height){
    var ruffle = window.RufflePlayer.newest(),
        player = Object.assign(document.getElementById(cont).appendChild(ruffle.createPlayer()), {
            width: width,
            height: height,
            style: 'width: ' + width + 'px; height: ' + height + 'px',
        });
    
    player.load({ url: url });
}

swfobject.embedSWF('https://kjsorolcl.github.io/%E1%84%92%E1%85%A6%E1%86%AF%E1%84%85%E1%85%A9%E1%84%8F%E1%85%B5%E1%84%90%E1%85%B5-%E1%84%90%E1%85%B3%E1%86%AF%E1%84%85%E1%85%B5%E1%86%AB%E1%84%80%E1%85%B3%E1%84%85%E1%85%B5%E1%86%B7%E1%84%8E%E1%85%A1%E1%86%BD%E1%84%80%E1%85%B5.swf', 'ruffle', 700, 600);
