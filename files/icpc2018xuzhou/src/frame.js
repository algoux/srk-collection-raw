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
function showCountdownNow(afterPage) {
    var timeStr = new Date().Format('yyyy-MM-dd hh:mm:ss');
    timeRun(timeStr,
        function () {
            setPage('countdown10.html');
        });
    var end = new Date(new Date(timeStr).getTime() + 14000).Format('yyyy-MM-dd hh:mm:ss');
    timeRun(end,
        function () {
            setPage(afterPage ? afterPage : $.lastPage);
        });
}

function now(){
    var time=new Date().getTime()+$.timespan;
    return new Date(time);
}
function refreshTime() {
    $.get('handler/gettime.ashx',
        function(r) {
            var serverTime = new Date(r);
            if (r.time) {
                $.timespan = new Date(r.time).getTime() - new Date().getTime();
            }
        });
}

function refreshParent() {
    parent.top.refresh();
}
