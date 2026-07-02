//生成表头
function GenerateTable() {
    //初始应为5列,根据题数目增加列
    var table = $('.scoreboard');
    var problems = Config.getProblemSet();
    $.each(problems,
        function (index, item) {
            table.find('.problemGroup').append('<col class="scoreprob" />');
            table.find('thead tr')
                .append("<th title=\"problem '{Name}'\"scope='col'><a>{Letter} <div class='circle' style='background-color: {RGB};'></div></a></th>".Format(item));
            table.find('tbody.summary tr')
                .append(' <td style="text-align: left;" class="tdSumP">' +
                    '<span class="octicon octicon-thumbsup"> </span>' +
                    '<span  title="number of accepted" class="nOK"> {nOK}</span>' +
                    '<br /><span class="octicon octicon-thumbsdown"> </span>' +
                    '<span  title="number of submissions" class="nJudged"> {nJudged}</span>' +
                    '<br /><span class="octicon octicon-clock"> </span>' +
                    '<span  title="first solved" class="nMin">{min}</span></td>');
        });
}
function ComputeSummary() {
    var table = $('.scoreboard');
    var problems = Config.getProblemSet();
    var scoreData = Config.getBoard();
    var siteSolved = 0;
    if (!scoreData)
        return;
    $.each(problems,
        function (index, p) {
            //table.find('tbody.scorebody tr').find('td.score_cell:eq(' + index + ')');
            var totalSolved = 0,totalJudged=0;
            var minTime = 10000;
            scoreData.forEach(function(x) {
                x.problems.map(function (t) {
                    if (t.label == p.Letter) {
                        if (t.solved) {
                            totalSolved++;
                            siteSolved++;
                        }
                        if (t.num_judged)
                            totalJudged += t.num_judged;
                        if (t.time && t.time < minTime)
                            minTime = t.time;
                    }
                });
            });
            var s = table.find('tbody.summary tr').find('td.tdSumP:eq(' + index + ')');
            s.find('.nOK').text(totalSolved);
            s.find('.nJudged').text(totalJudged);
            minTime = minTime == 10000 ? '' : minTime;
            s.find('.nMin').text(minTime);
        });
    table.find('.siteSolved').text(siteSolved);
}

function showScoreData() {
    var teams = Config.getTeams();
    var scoreData = Config.getBoard();
    var problems = Config.getProblemSet();

    var strRowTeam = '<tr id="team:{id}">' +
    '<td class="scorepl">{rank}</td>' +
    '<td class="scoreaf"><img src="picture/{Icon}.png" alt="" title="{School}" width="32" height="32" />&nbsp;{School}</td>' +
    '<td class="scoretn"><span class="teamName">{Name}</span><br><span class="teamEName">({NameEn})</span></td>' +
    '<td class="scorenc">{num_solved}</td>' +
    '<td class="scorett">{total_time}</td>   </tr>';

    var strCellwrap = '<td class="score_cell"></td>';
    var strCelldiv = '<div >{time}<span>{num_judged} tries</span></div>';

    var scoreBody = $("<tbody></tbody>");
    if (!scoreData)
        return;

    //计算队伍数
    var teamCount = teams.length;
    for (var i = 0; i < teams.length; i++) {
        if (teams[i].Star)
            teamCount--;
    }
    

  
    var medalCount = 0;
    for (var index = 0; index < scoreData.length; index++) {
        var item = scoreData[index];


        var team = teams.find((n) => n.id == item.team);//挑出队伍
        try {
            var combine = CombineObject(CombineObject(team, item.score), item);
            //if (!combine)
            //    console.log(team,item);
            var scoreRow = $(strRowTeam.Format(combine));
            if (team.Star)//if (team.memo && team.memo.indexOf('*') >= 0) //加星队伍
                scoreRow.find('.scoretn').prepend('<i class="fa fa-star starTeam"></i>');
            if (team.memo && team.memo.indexOf('Female') >= 0) //女队
                scoreRow.find('.teamName').addClass('teamFemale');

            if ($.giveMedal) {
                var medalName="";
                if (!team.Star ) { //if (team.memo==undefined || team.memo.indexOf('*') < 0) {
                    if (medalCount < parseInt(teamCount*0.1))
                        medalName = "gold";
                    else if (medalCount < parseInt(teamCount*0.3))
                        medalName = "silver";
                    else if (medalCount < parseInt(teamCount*0.6))
                        medalName = "bronze";
                    scoreRow.find('.scorepl').addClass(medalName);
                    medalCount++;
                }
            }
            for (var i = 0; i < item.problems.length; i++) {
                var cell = $(strCellwrap);
                var empty = { time: '--' };
                var celldiv = $(strCelldiv.Format(item.problems[i]).Format(empty));
                if (item.problems[i].solved) {
                    celldiv.addClass('score_correct');
                    if (item.problems[i].first_to_solve)
                        celldiv.addClass('score_first');
                    cell.append(celldiv);
                } else if (item.problems[i].num_judged > 0) {
                    if (item.problems[i].num_pending > 0)
                        celldiv.addClass('score_pending');
                    else
                        celldiv.addClass('score_incorrect');
                    cell.append(celldiv);
                }
                scoreRow.append(cell);
            }

            $(scoreBody).append(scoreRow);
        }
        catch (err) {
            console.log('error ' + item.team);
            console.log(team);
            console.log(item);
        }
    };
    //if (!$.giveMedal)
        scoreBody.find('tr:even').addClass('even');
    $('.scoreboard').find('.scorebody').html(scoreBody.html());
}

var Config = {
    getProblemSet: function (func) {
        if ($.problemSet)
            return $.problemSet;
        else
        //return ($.ProblemSet = readCSV('html/problemSet.csv'));
        {
            
            $.ajax({
                type: 'GET',
                dataType: 'json',
                url: "handler/GetData.ashx?table=problem",
                async: typeof func == 'function',
                success: function(r) {
                    $.problemSet= r;
                },
                fail: function(r) {
                    console.log(r);
                }
            });
            return $.problemSet;
        }
    },
    getTeams: function (func) {
        if ($.teams)
            return $.teams;
        else
        //return ($.teams = readCSV('html/teams.csv'));
        {
            var ret;
            $.ajax({
                type: 'GET',
                dataType: 'json',
                url: "handler/GetData.ashx?table=team",
                async: typeof func == 'function',
                success: function (r) {
                    ret = r;
                },
                fail: function (r) {
                    console.log(r);
                }
            });
            return ret;
        }
    },
    getBoard: function () {
        if ($.board)
            return $.board;
        else {
            $.board = readJson('html/scoreboard.json');
            return $.board;
            //if (!$.board)
            //    updateBoard();
        }
    }
}

function giveMedal() {
    var teams = Config.getTeams();
//...
}

function autoScroll() {
    var totalHeight = $('body').height();

    var screenHeight = $(window).height();
    var curTop = 0;
    if ($.curPage == undefined)
        $.curPage = 0;
    setInterval(function () {
        if ($.autoScroll) {
            $.curPage++;
            if ($.curPage > totalHeight / screenHeight)
                $.curPage = 0;
            var top = $.curPage * screenHeight;
            $("html,body").animate({ scrollTop: top }, 1000);
        }
    }, 10000);
    
}

function updateBoard() {
    if (!$.refreshData)
        return;
    $.get('handler/updatedata.ashx',
        function(r) {
            if (typeof r == 'string')
                $.board = JSON.parse(r);
            else
                $.board = r;
            showScoreData();
        });
    $.get('handler/updatedata.ashx?question=CheckFreeze',
   
        function (r) {
            var result;
            if (typeof r == 'string')
                result = JSON.parse(r);
            else
                result = r;
       
                showPending(result.result);
        });
}
function showPending(show) {
    if (show == undefined)
        show = true;
    if ($('#pending').prop('visible') != show) {
        if (show) {

            $('#pending').show();
            console.log('封榜');
        } else {

            $('#pending').hide();
            console.log('解除封榜');
        }
    }
}

function now(){
    var time=new Date().getTime+$.timespan;
    return new Date(local);
}

$(function () {
    
    //$('html').addClass('loading');
    console.log('Generating table');

    GenerateTable();
    showScoreData();
    ComputeSummary();
    console.log('table shown');
    $('html').removeClass('loading');
    setTimeout(function() {
        $('.loading-container').hide();
    },0);

    if ($.refreshData)
        $('#showBalloon').parent().show();

    //var teams = Config.getTeams();
    //$.each(teams,
    //    function(index, item) {
    //        $('#test').append('<div><img src="picture/' + item.icon + '.png" />' + item.school + '</div>');
    //    });
    setInterval(updateBoard, 10000);
    $.autoScroll = $('#autoscroll').prop('checked');
    autoScroll();
    $('#autoscroll').click(function() {
        $.autoScroll = $('#autoscroll').prop('checked');
    });
    $.showBalloon = $('#showBalloon').prop('checked');
    $('#showBalloon').click(function () {
        $.showBalloon = $('#showBalloon').prop('checked');
    });
})