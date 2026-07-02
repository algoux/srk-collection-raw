function refreshPage() {
    $.get('html/framepage.txt',
        function(r) {
            var lines = r.replace(/\r/g, '').split('\n');
            lines.forEach(function(val, index) {
                val = val.trim();
                if (val[0] == '*') {
                    var url = val.replace('*', '');
                    if ($.lastPage != url) {
                        setPage(url);
                        $.lastPage = url;
                    }
                }
            });
        });
}

function setPage(url) {
    $('#mainFrame').attr('src', url);
}

function showCountdown(timeStr) {
    timeRun(timeStr,
        function () {
            setPage('countdown10.html');
        });
    var end = new Date(new Date(timeStr).getTime() + 14000).Format('yyyy-MM-dd hh:mm:ss');
    timeRun(end,
    function () {
        setPage($.lastPage);
    });
}

function now(){
    var time=new Date().getTime()+$.timespan;
    return new Date(time);
}
function refreshTime() {
    $.get('handler/gettime.ashx', function (r) {
        var serverTime = new Date(r);
        if (r.time) {
            $.timespan = new Date(r.time).getTime() - new Date().getTime();
        }
    })
}

function refreshParent() {
    parent.top.refresh();
}
$(function () {
    //$('#mainFrame').attr('src', 'board.html');

    refreshPage();
    setInterval(refreshPage, 2000);
    setInterval(refreshTime,10000);

    setTimeout(() => {
        $.lastPage = "board.html";
        // showCountdown('2018-6-3 08:59:50');
        // timeRun('2018-6-3 09:00:05', function () {
        //    setPage('board.html');       
        // });
        showCountdown('2018-10-9 00:02:00');
        timeRun('2018-10-9 00:02:15', function () {
           setPage('board.html');       
        });            
    }, 10000);
})