//公用函数库 by NoZ 2018

Date.prototype.Format = function (fmt) { //author: meizz   
    var o = {
        "M+": this.getMonth() + 1, //月份   
        "d+": this.getDate(), //日   
        "h+": this.getHours(), //小时   
        "m+": this.getMinutes(), //分   
        "s+": this.getSeconds(), //秒   
        "q+": Math.floor((this.getMonth() + 3) / 3), //季度   
        "S": this.getMilliseconds() //毫秒   
    };
    if (/(y+)/.test(fmt))
        fmt = fmt.replace(RegExp.$1, (this.getFullYear() + "").substr(4 - RegExp.$1.length));
    for (var k in o)
        if (new RegExp("(" + k + ")").test(fmt))
            fmt = fmt.replace(RegExp.$1, (RegExp.$1.length == 1) ? (o[k]) : (("00" + o[k]).substr(("" + o[k]).length)));
    return fmt;
}

//定时运行
function timeRun(time, func) {
    var cur = new Date();
    var timeDest = new Date(time);
    
    // console.log(cur.getTime());
    if ($.timespan)
    {
        // console.log($.timespan);
        // console.log(timeDest.getTime());
        timeDest = new Date(timeDest.getTime()- $.timespan); //时间校正
        
    }
    else if ($.timespan==undefined)
        $.timespan=0;
    // console.log(timeDest);
    if (cur > timeDest && cur.getTime() < timeDest.getTime() + 10000) {//十秒内
        console.log('到点了:  服务器时间' + new Date(cur.getTime() + $.timespan).Format('hh:mm:ss.S') + '  本地时间' + new Date().Format('hh:mm:ss:S'));
        if (typeof func == 'function')
            func();
        else if (typeof func == 'string')
            eval(func);
    } else {
        setTimeout(function () {
            timeRun(time, func)
        }, 5);
    }
}


//读取csv文件转换为json文件
function readCSV(file, seprator, func) {
    var ret = [];
    if (!seprator)
        seprator = ',';

    $.ajax({
        type: 'GET',
        url: file,
        dataType: 'text',
        async: typeof func == 'function',
        error: function (r) {
            console.log(r);
        },
        success: function (txt) {
            //try 

            var lines = txt.replace(/\r/g, '').split('\n');
            var rows = lines.length - 1;
            if (lines.length > 0) {
                var titles = lines[0].split(seprator);
                var cols = titles.length;
                for (var row = 1; row <= rows; row++) {
                    var item = {};
                    for (var col = 0; col < cols; col++) {
                        var line = lines[row].split(seprator);
                        item[titles[col]] = line[col];
                    }
                    ret.push(item);
                }
            }
            if (typeof func == 'function')
                func(ret);

        }
    });
    //if (typeof func != 'function') { //同步模式
    return ret;
    //}
}

function readJson(file, func) {
    var ret;

    $.ajax({
        type: 'GET',
        url: file,
        dataType: 'json',
        async: typeof func == 'function',
        success: function (r) {
            //try 
            {
                ret = r;
                if (typeof func == 'function')
                    func(ret);
            }
            //catch (e) {
            //    console.log("异常")
            //}
        },
        fail: function (r) {
            console.log(r);
        }
    });
    //if (typeof func != 'function') { //同步模式
    return ret;
    //}
}

String.prototype.Format = function (val) {
    var str = this;
    for (var i in val) {
        var reg = new RegExp("\{" + i + "\}", 'g');
        str = str.replace(reg, val[i]);
    }
    return str;
};

CombineObject = function (obj1, obj2) {
    var o = obj1;
    for (var i in obj2) {
        o[i] = obj2[i];
    }
    return o;
};