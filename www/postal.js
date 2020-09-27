/***********************************************************************
 *
 * Helpers.
 *
 **********************************************************************/

function has_compression()
{
    return typeof enable_compression !== 'undefined' ? enable_compression : true;
}

function has_profiling()
{
    return typeof enable_profiling !== 'undefined' ? enable_profiling : false;
}

/***********************************************************************
 *
 * Palette management.
 *
 **********************************************************************/

/*
 * Blackout some colors from the palette.
 */
const palette_blackout = [2, 6, 10];

/*
 * Stolen from dygraph.js. Generate a color from HSV.
 */
function hsvToRGB(hue, saturation, value)
{
    var red;
    var green;
    var blue;

    if (saturation === 0) {
        red = value;
        green = value;
        blue = value;
    } else {
        var i = Math.floor(hue * 6);
        var f = hue * 6 - i;
        var p = value * (1 - saturation);
        var q = value * (1 - saturation * f);
        var t = value * (1 - saturation * (1 - f));
        switch (i) {
        case 1:
            red = q;green = value;blue = p;break;
        case 2:
            red = p;green = value;blue = t;break;
        case 3:
            red = p;green = q;blue = value;break;
        case 4:
            red = t;green = p;blue = value;break;
        case 5:
            red = value;green = p;blue = q;break;
        case 6: // fall through
        case 0:
            red = value;green = t;blue = p;break;
        }
    }
    red = Math.floor(255 * red + 0.5);
    green = Math.floor(255 * green + 0.5);
    blue = Math.floor(255 * blue + 0.5);
    return 'rgb(' + red + ',' + green + ',' + blue + ')';
}

/*
 * Get a unique color.
 */
function getNextColor()
{
    g_state.palette_index++;
    while (palette_blackout.indexOf(g_state.palette_index) >= 0) {
        g_state.palette_index++;
    }
    var index = g_state.palette_index;

    /*
     * Per https://martin.ankerl.com/2009/12/09/how-to-create-random-colors-programmatically/
     */
    const golden_ratio_conjugate = 0.618033988749895;
    h = 0;
    h += golden_ratio_conjugate * index;
    h %= 1;

    return hsvToRGB(h, 0.99, 0.99);
}

/***********************************************************************
 *
 * Interaction handlers.
 *
 **********************************************************************/

/*
 * A hack to force repositioning the legend properly.
 */
function forceRepositionLegend()
{
    // XXX: this could be improved.
    // See https://stackoverflow.com/questions/55931159/legends-do-not-stay-in-place-when-resizing-linked-graphs-in-dygraphs
    var oldLegendDirection = g_state.legendDirection;
    g_state.legendDirection = 0;
    showLegend(oldLegendDirection);
}

/*
 * Common callback for redrawing/updating options.
 */
function redrawWithOptions(newOptions)
{
    /*
     * Force "un-stacking" the plots for any redraw operation that does not set
     * the Y axes ranges.
     */
    if (!("axes" in newOptions)) {
        newOptions.axes = {};
    }
    if (!("y" in newOptions.axes)) {
        newOptions.axes.y = {};
    }
    if (!("y2" in newOptions.axes)) {
        newOptions.axes.y2 = {};
    }
    if (!("valueRange" in newOptions.axes.y)) {
        newOptions.axes.y.valueRange = null;
    }
    if (!("valueRange" in newOptions.axes.y2)) {
        newOptions.axes.y2.valueRange = null;
    }

    /*
     * Now we actually update the options...
     *
     * Due to the legend position issue, we first do a non-drawing update, then
     * forceRepositionLegend() will do the redraw.
     */
    var t1 = new Date();
    g_plot.updateOptions(newOptions, false);
    var t2 = new Date();
    forceRepositionLegend();
    var t3 = new Date();

    if (has_profiling()) {
        console.log("postal - updateOpt: " + (t2 - t1) + "ms");
        console.log("postal - redraw: " + (t3 - t2) + "ms");
    }

    $('#cover-spin').hide(0);
}

/*
 * Invoked when clicking on a label in the selection bar.
 */
function plotElement(index, label, direction)
{
    var fetch = false;
    var id = getIndex(label);
    if (id == -1) {
        /*
         * Add "default" options for the new series.
         */
        g_state.options.labels.push(label);
        g_state.options.visibility.push(true);
        g_state.options.series[label] = {
            color: "#000000",
            axis: "y",
        };

        /*
         * We'll be fetching the data asynchronously at the bottom of the
         * function.
         */
        fetch = true;
        $('#cover-spin').show(0);

        id = g_state.options.labels.length - 1;
    }

    var newOptions = {
        axes: {
            y2: {},
        },
        series: {
        },
    };
    newOptions.series[label] = {};

    /*
     * Display either to the left or to the right (like a sliding switch), or
     * stop displaying if the already-checked checkbox is clicked as second
     * time.
     */
    if (direction == -1) {
        document.getElementById("select_right_" + index).checked = false;
        if (g_state.plot[index] == -1) {
            document.getElementById("select_left_" + index).checked = false;
            direction = 0;
            g_state.numVisible--;
        } else {
            if (g_state.plot[index] == 0) {
                g_state.last_palette_element_index = index;
                newOptions.series[label].color = g_state.options.series[label].color =
                    getNextColor();
                g_state.numVisible++;
            } else {
                g_state.numVisibleOnRight--;
            }
            newOptions.series[label].axis = g_state.options.series[label].axis = "y";
        }
    } else if (direction == 1) {
        document.getElementById("select_left_" + index).checked = false;
        if (g_state.plot[index] == 1) {
            document.getElementById("select_right_" + index).checked = false;
            direction = 0;
            g_state.numVisible--;
            g_state.numVisibleOnRight--;
        } else {
            if (g_state.plot[index] == 0) {
                g_state.last_palette_element_index = index;
                newOptions.series[label].color = g_state.options.series[label].color =
                    getNextColor();
                g_state.numVisible++;
            }
            newOptions.series[label].axis = g_state.options.series[label].axis = "y2";
            g_state.numVisibleOnRight++;
        }
    }

    /*
     * Don't display the right-side ticker if no series is plotted on the axis.
     */
    if (g_state.numVisibleOnRight) {
        newOptions.axes.y2.ticker = g_state.options.axes.y2.ticker = Dygraph.numericLinearTicks;
    } else {
        newOptions.axes.y2.ticker = g_state.options.axes.y2.ticker = noTicks;
    }

    g_state.plot[index] = direction;

    /*
     * Handle removing from the plot.
     */
    if (!direction) {
        if (g_state.last_palette_element_index == index) {
            g_state.palette_index--;
        }
        removeFromPlot(label);
    }

    /*
     * Reset the palette if all series have been removed from the plot.
     */
    if (g_state.numVisible == 0) {
        g_state.palette_index = -1;
    }

    newOptions.visibility = g_state.options.visibility;
    newOptions.file = g_state.filter ? g_state.filteredData : g_state.data;

    if (fetch) {
        plotData(label, redrawWithOptions, newOptions);
    } else {
        redrawWithOptions(newOptions);
    }
}

/*
 * Populate a single element in the search pane.
 */
function addSelectElement(select, index, label, direction)
{
    var div = document.createElement("div");
    div.className = "select_element";
    div.style["width"] = "100%";
    div.style["white-space"] = "nowrap";
    var plotLeft = document.createElement("input");
    plotLeft.className = "checkbox";
    plotLeft.id = "select_left_" + index;
    plotLeft.type = "checkbox";
    plotLeft.checked = direction == -1;
    plotLeft.onclick = function() {
        plotElement(index, label, -1);
    };
    var plotRight = document.createElement("input");
    plotRight.className = "checkbox";
    plotRight.id = "select_right_" + index;
    plotRight.type = "checkbox";
    plotRight.checked = direction == 1;
    plotRight.onclick = function() {
        plotElement(index, label, 1);
    };
    var labelElement = document.createElement("label");
    if (label in g_dataset.valid_map) {
        labelElement.innerHTML = '<abbr title="Conditioned by ' + g_dataset.valid_map[label] +
            '">' + label + '</abbr>';
    } else {
        labelElement.innerHTML = label;
    }

    div.appendChild(plotLeft);
    div.appendChild(plotRight);
    div.appendChild(labelElement);
    select.appendChild(div);
}

/*
 * Invoked when searching for a element through the text box in the selection bar.
 */
function refreshSelect(regex)
{
    if (typeof refreshSelect.selectDiv == "undefined") {
        refreshSelect.selectDiv = document.getElementById("select");
    }
    refreshSelect.selectDiv.innerHTML = "";

    /*
     * Make the search case-insensitive.
     */
    regex = ".*" + regex.toLowerCase() + ".*";

    var numItems = g_dataset.labels.length;

    /*
     * Always display the plotted element first.
     */
    for (var index = 0; index < numItems; index++) {
        var element = g_dataset.labels[index];
        var direction = g_state.plot[index];
        if (direction) {
            addSelectElement(refreshSelect.selectDiv, index, element, direction);
        }
    }

    /*
     * Then display the filtered elements.
     */
    for (var index = 0; index < numItems; index++) {
        var element = g_dataset.labels[index];
        var direction = g_state.plot[index];
        if (element.toLowerCase().match(regex) && !direction) {
            addSelectElement(refreshSelect.selectDiv, index, element, direction);
        }
    }
}

/*
 * Invoked when the "legend" checkboxes are clicked.
 */
function showLegend(direction)
{
    var newOptions = {};

    if (typeof showLegend.left == "undefined") {
        showLegend.left = document.getElementById("legend_left");
        showLegend.right = document.getElementById("legend_right");
        showLegend.legendDiv = document.getElementsByClassName("dygraph-legend")[0];
        showLegend.graphDiv = document.getElementById("graph");
    }

    if (direction == -1) {
        showLegend.right.checked = false;
        if (g_state.legendDirection == -1) {
            showLegend.left.checked = false;
            newOptions.legend = g_state.options.legend = "never";
            direction = 0;
        } else {
            showLegend.legendDiv.style.left = "85px";
            showLegend.legendDiv.style.right = null;
            newOptions.legend = g_state.options.legend ="always";
        }
    } else if (direction == 1) {
        showLegend.left.checked = false;
        if (g_state.legendDirection == 1) {
            showLegend.right.checked = false;
            newOptions.legend = g_state.options.legend = "never";
            direction = 0;
        } else {
            showLegend.legendDiv.style.right = "50px";
            showLegend.legendDiv.style.left = null;
            newOptions.legend = g_state.options.legend ="always";
        }
    }

    g_state.legendDirection = direction;

    /*
     * Note: we don't use redrawWithOptions() here to avoid recursion.
     */
    g_plot.updateOptions(newOptions);
}

/*
 * Invoked when the "points" checkbox is clicked.
 */
function showPoints(show)
{
    g_state.options.drawPoints = show;

    redrawWithOptions({
        drawPoints: show,
    });
}

/*
 * Invoked when the "filter" checkbox is clicked.
 */
function enableFilter(enable)
{
    g_state.filter = enable;

    redrawWithOptions({
        file: g_state.filter ? g_state.filteredData : g_state.data,
    });
}

/*
 * Invoked when the "highlight" checkbox is clicked.
 */
function enableHighlights(enable)
{
    if (enable) {
        g_state.options.highlightSeriesOpts = {
            "strokeWidth": 2,
        };
    } else {
        g_state.options.highlightSeriesOpts = null;
    }
    g_state.options.highlightSeriesBackgroundAlpha = enable ? 0.35 : 1;

    g_state.highlight = enable;

    redrawWithOptions({
        highlightSeriesOpts: g_state.options.highlightSeriesOpts,
        highlightSeriesBackgroundAlpha: g_state.options.highlightSeriesBackgroundAlpha,
    });
}

/*
 * Invoked when the "range sel." checkbox is clicked.
 */
function enableRangeSelector(enable)
{
    g_state.options.showRangeSelector = enable;

    redrawWithOptions({
        showRangeSelector: enable,
    }, false);
}

/*
 * Invoked when the "annotations" checkbox is clicked.
 */
function showAnnotations(show)
{
    annotations = [];
    if (show) {
        for (var xval in g_state.annotations) {
            annotations.push({
                xval: xval,
                interpolated: false,
            });
        }
    }
    g_hairlines.set(annotations);

    g_state.annotate = show;
}

/*
 * Timer for live updates.
 */
const plotLiveInterval = 10000;
function updatePlotLive()
{
    // TODO: Fetch and merge new data.

    if (g_state.timerId != null) {
        g_state.timerId = setTimeout(updatePlotLive, plotLiveInterval);
    }
}

/*
 * Invoked when the "live" checkbox is clicked.
 */
function enableLive(enable)
{
    if (enable && !g_state.live) {
        /*
         * Clear the cache.
         */
        g_state.cache = {};
        g_state.cacheEntries = [];

        /*
         * Setup the refresh timer.
         */
        g_state.timerId = setTimeout(updatePlotLive, plotLiveInterval);
    } else if (!enable && g_state.live) {
        var timerId = g_state.timerId;
        g_state.timerId = null;
        clearTimeout(timerId);
    }

    g_state.live = enable;
}

/*
 * ID generation in annotate() adapted from
 * https://stackoverflow.com/questions/1349404/generate-random-string-characters-in-javascript
 */
function dec2hex(dec)
{
    return ('0' + dec.toString(16)).substr(-2)
}

/*
 * Invoked when the "annotate" button is pushed.
 */
function annotate()
{
    if (g_state.annotate) {
        [currentMin, currentMax] = g_plot.xAxisRange();
        t = (currentMin + currentMax) / 2;
        while (t in g_state.annotations) {
            t += 0.001;
        }
        var text = prompt("Annotation string:", "new annotation");
        var arr = new Uint8Array(16);
        window.crypto.getRandomValues(arr)
        var id = Array.from(arr, dec2hex).join('');
        g_state.annotations[t] = [id, text, false];
        pushAnnotation(id, t, text);
        sortAnnotations();
        showAnnotations(true);
    } else {
        alert("You must enable showing annotations first!");
    }
}

/*
 * Invoked when the "lock" icon of an annotation is clicked.
 */
function lockAnnotation(xval)
{
    var ann = document.getElementById("ann_" + xval);
    var lock = document.getElementById("lock_" + xval);
    var kill = document.getElementById("kill_" + xval);
    var edit = document.getElementById("edit_" + xval);

    g_state.annotations[xval][2] = !g_state.annotations[xval][2];
    if (g_state.annotations[xval][2]) {
        $(ann).draggable('disable');
        lock.src = "contents/icons/locked.png";
        kill.hidden = true;
        edit.hidden = true;
    } else {
        $(ann).draggable('enable');
        lock.src = "contents/icons/unlocked.png";
        kill.hidden = false;
        edit.hidden = false;
    }
}

/*
 * Invoked when the "edit" icon of an annotation is clicked.
 */
function editAnnotation(xval)
{
    var id = g_state.annotations[xval][0];
    var text = prompt("Annotation string:", g_state.annotations[xval][1]);
    if (text != null) {
        g_state.annotations[xval][1] = text;
        updateAnnotation(id, xval, text);
        showAnnotations(true);
    }
}

/*
 * Adapted from
 * https://medium.com/better-programming/3-ways-to-clone-objects-in-javascript-f752d148054d
 */
function specialCopy(src, attr)
{
    var target = {};
    for (var prop in src) {
        /*
         * Don't copy the wildly irrelevant fields or the really large ones.
         */
        if (attr == "state" && (prop == "live" ||
                                prop == "timerId" || prop == "annotationTimerId" ||
                                prop == "data" || prop == "filteredData" || prop == "cache" ||
                                prop == "cacheEntries" ||
                                prop == "annotations" || prop == "plot" ||
                                prop == "sortedAnnotations")) {
            continue;
        }
        if (attr == "options" && (prop == "axes" || prop == "plugins" ||
                                  prop == "connectSeparatedPoints" ||
                                  prop == "digitsAfterDecimal" ||
                                  prop == "gridLineColor" || prop == "maxNumberWidth" ||
                                  prop == "panEdgeFraction" || prop == "pointSize" ||
                                  prop == "yRangePad" || prop == "timingName")) {
            continue;
        }

        if (src.hasOwnProperty(prop)) {
            var type = typeof src[prop];

            /*
             * Deep copy of nested objects.
             */
            if (type === 'object' && !!src[prop]) {
                if (!Array.isArray(src[prop])) {
                    target[prop] = specialCopy(src[prop], prop);
                } else {
                    target[prop] = Array.from(src[prop]);
                }
            } else if (type === "function") {
                /*
                 * Do nothing for functions.
                 */
            } else {
                target[prop] = src[prop];
            }
        }
    }
    return target;
}

/*
 * https://stackoverflow.com/questions/31593297/using-execcommand-javascript-to-copy-hidden-text-to-clipboard
 */
function copyToClipboard(value)
{
    var tempInput = document.createElement("input");
    tempInput.style = "position: absolute; left: -1000px; top: -1000px";
    tempInput.value = value;
    document.body.appendChild(tempInput);
    tempInput.select();
    document.execCommand("copy");
    document.body.removeChild(tempInput);
}

/*
 * Invoked when the "share" button is pushed.
 */
function share()
{
    if (g_state.options.labels.length <= 3) {
        alert("You must select one or more telemetry keys first!");
        return;
    }

    var request = new XMLHttpRequest();
    request.open("POST", 'cgi-bin/share.py');
    request.setRequestHeader("Content-Type", "application/json");

    request.onreadystatechange = function() {
        if (this.readyState === XMLHttpRequest.DONE && this.status === 200) {
            var result = JSON.parse(request.responseText);
            copyToClipboard(postal_url + "/view.html?s=" + result.share);
        }
    }

    /*
     * Copy and sanitize the state.
     */
    var shareData = specialCopy(g_state, "state");

    /*
     * Refresh the state maintained by Dygraph only.
     */
    shareData.options.dateWindow = g_plot.xAxisRange();
    zoomed = g_plot.isZoomed("y");
    [yRange, y2Range] = g_plot.yAxisRanges();
    shareData.options.axes = {x: {}, y: {}, y2: {}};
    if (zoomed) {
        shareData.options.axes.y.valueRange = yRange;
        shareData.options.axes.y2.valueRange = y2Range;
    }

    request.send(JSON.stringify(shareData));
}

/*
 * Invoked when the "to PNG" button is pushed.
 */
function downloadPNG()
{
    if (g_state.options.labels.length <= 3) {
        alert("You must select one or more telemetry keys first!");
        return;
    }

    var canvas = Dygraph.Export.asCanvas(g_plot);
    var a = document.createElement("a");
    a.style.display = "none";
    a.href = canvas.toDataURL();
    a.setAttribute("download", "plot_" + g_dataset.datasetId + ".png");
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}

/*
 * Invoked when the "to CSV" button is pushed.
 */
function exportCSV()
{
    if (g_state.options.labels.length <= 3) {
        alert("You must select one or more telemetry keys first!");
        return;
    }

    [currentMin, currentMax] = g_plot.xAxisRange();

    csv = "data:text/csv;charset=utf-8,t,";
    for (var column = 3; column < g_state.options.labels.length; column++) {
        csv += g_state.options.labels[column] + ",";
    }
    csv += "\n";

    const data = g_state.filter ? g_state.filteredData : g_state.data;

    var row;
    for (row = 0; row < data.length && data[row][0] < currentMin; row++)
        ;
    for (; row < data.length && data[row][0] <= currentMax; row++) {
        csv += data[row][0] + ",";
        for (var column = 3; column < g_state.options.labels.length; column++) {
            if (data[row][column] == null) {
                csv += ",";
                continue;
            }

            var label = g_state.options.labels[column];
            if (label in g_dataset.enums) {
                csv += g_dataset.enums[label][data[row][column]] + ",";
            } else {
                csv += data[row][column] + ",";
            }
        }
        csv += "\n"
    }

    var a = document.createElement("a");
    a.style.display = "none";
    a.href = encodeURI(csv);;
    a.setAttribute("download", "export_" + g_dataset.datasetId + ".csv");
    document.body.appendChild(a);
    a.click();

    window.URL.revokeObjectURL(a.href);
    document.body.removeChild(a);
}

/*
 * Invoked when the "zoom out" button is pushed.
 */
function zoomout()
{
    [absoluteMin, absoluteMax] = g_plot.xAxisExtremes();
    [currentMin, currentMax] = g_plot.xAxisRange();

    center = (currentMin + currentMax) / 2;
    win = currentMax - currentMin;

    /*
     * Zoom out by a factor of 4 (times 4, divided by 2 since we zoom out from
     * both ends).
     */
    win *= 2

    newMin = center - win;
    if (newMin < absoluteMin) {
        newMin = absoluteMin;
    }
    newMax = center + win;
    if (newMax > absoluteMax) {
        newMax = absoluteMax;
    }

    redrawWithOptions({
        dateWindow: [newMin, newMax],
    });
}

/*
 * Invoked when the "stack plots" button is pushed.
 */
function stack()
{
    if (!g_plot.isZoomed("y")) {
        [yRange, y2Range] = g_plot.yAxisRanges();

        yRange[1] = yRange[1] + (yRange[1] - yRange[0]);
        y2Range[0] = y2Range[0] - (y2Range[1] - y2Range[0]);

        redrawWithOptions({
            axes: {
                y: {
                    valueRange: [yRange[0], yRange[1]],
                },
                y2: {
                    valueRange: [y2Range[0], y2Range[1]],
                },
            },
        });
    } else {
        redrawWithOptions({
            axes: {
                y: {
                    valueRange: null,
                },
                y2: {
                    valueRange: null,
                },
            },
        });
    }
}

/*
 * Invoked upon click on a point.
 */
function copyPoint(event, point)
{
    var val = numberValueFormatter(point.yval);
    if (point.name in g_dataset.enums) {
        val = g_dataset.enums[point.name][val];
    }

    copyToClipboard(point.name + " @" + point.xval + "=" + val);
}

/***********************************************************************
 *
 * Data formatters.
 *
 **********************************************************************/

function padTwoZeros(x)
{
    return (x < 10) ? "0" + x : x;
}

function padThreeZeros(x)
{
    return (x < 100) ? "0" + padTwoZeros(x) : x;
}

function getDecimal(n)
{
    var n = Math.abs(n);
    return n - Math.floor(n);
}

/*
 * Format times for the X axis.
 */
var lastTimeFormatted = null;
function timeFormatter(t, granularity)
{
    var date = new Date(parseInt(t) * 1000);
    var result = "";

    if (lastTimeFormatted == null || lastTimeFormatted.getDate() != date.getDate()) {
        result += (date.getMonth() + 1) + "/" + date.getDate() + " ";
    }
    lastTimeFormatted = date;

    result += (padTwoZeros(date.getHours()) + ":" +
               padTwoZeros(date.getMinutes()) + ":" +
               padTwoZeros(date.getSeconds()));

    return "<font size='1'>" + result + "<font>";
}

/*
 * XXX: This should be take from Dygraph.Export instead of copy/paste.
 */
function round_(num, places) {
  var shift = Math.pow(10, places);
  return Math.round(num * shift) / shift;
}
function numberValueFormatter(x)
{
    var digits = g_state.options.digitsAfterDecimal;
    var maxNumberWidth = g_state.options.maxNumberWidth;

    var label;

    // switch to scientific notation if we underflow or overflow fixed display.
    if (x !== 0.0 && (Math.abs(x) >= Math.pow(10, maxNumberWidth) || Math.abs(x) < Math.pow(10, -digits))) {
        label = x.toExponential(digits);
    } else {
        label = '' + round_(x, digits);
    }
    return label;
}

/*
 * Format legends.
 */
function legendFormatter(data)
{
    var html = "<label class='unselectable'>";

    if (data.xHTML != null) {
        var date = new Date(parseInt(data.x) * 1000);

        html += ((1900 + date.getYear()) + "/" +
                 (1 + date.getMonth()) + "/" +
                 date.getDate() + " " +
                 padTwoZeros(date.getHours()) + ":" +
                 padTwoZeros(date.getMinutes()) + ":" +
                 padTwoZeros(date.getSeconds()) + "." +
                 padThreeZeros(parseInt(getDecimal(data.x) * 1000))) + " Local";
        html += "<br>";
        html += (date.getUTCFullYear() + "/" +
                 (1 + date.getUTCMonth()) + "/" +
                 date.getUTCDate() + " " +
                 padTwoZeros(date.getUTCHours()) + ":" +
                 padTwoZeros(date.getUTCMinutes()) + ":" +
                 padTwoZeros(date.getUTCSeconds()) + "." +
                 padThreeZeros(parseInt(getDecimal(data.x) * 1000))) + " UTC";
        html += "<br>";
        html += data.x + " since Epoch";
    } else {
        html += "<br><br>";
    }

    const row = data.dygraph.getRowForX(data.x);

    data.series.forEach(function(series) {
        if (!series.isVisible) {
            return;
        }

        html += "<br>";
        if (g_state.options.series[series.label].axis == "y") {
            html += series.dashHTML + "&nbsp;&nbsp;&nbsp;&nbsp; ";
        } else {
            html += "&nbsp;&nbsp;&nbsp;&nbsp;" + series.dashHTML + " ";
        }
        if (g_state.highlight && series.isHighlighted) {
            html += "<b>";
        }

        var is_near_point = false;
        var y = series.y;

        /*
         * Attempt to get the nearest best point.
         */
        const max_delta = 0.75;
        if (y == null) {
            const col = getIndex(series.label);
            const data = g_state.filter ? g_state.filteredData : g_state.data;

            var delta_prev = Number.MAX_VALUE;
            if (row > 0) {
                delta_prev = data.x - data[row - 1][0];
            }

            var delta_next = Number.MAX_VALUE;
            if (row + 1 < data.length) {
                delta_next = data[row + 1][0] - data.x;
            }

            if (delta_prev < delta_next) {
                if (delta_prev <= max_delta) {
                    y = data[row - 1][col];
                    is_near_point = true;
                }
            } else if (delta_next <= max_delta) {
                y = data[row + 1][col];
                is_near_point = true;
            }
        }

        if (y != null) {
            html += series.label + ": ";
            if (series.label in g_dataset.enums) {
                labels = g_dataset.enums[series.label];
                if (y in labels) {
                    html += labels[y];
                } else {
                    html += numberValueFormatter(y);
                }
            } else {
                html += numberValueFormatter(y);
            }
            if (is_near_point) {
                html += " (near)";
            }
        } else {
            html += series.label;
        }
        if (g_state.highlight && series.isHighlighted) {
            html += "</b>";
        }
    });

    html += "</label>";

    return html;
}

/*
 * A special ticker to hide ticks while still drawing the axis.
 */
function noTicks()
{
    return [];
}

/***********************************************************************
 *
 * Data structures and Dygraph instanciation.
 *
 **********************************************************************/

/*
 * Merge data into the plot.
 */
function mergeData(data, series)
{
    /*
     * Merge the new data with the current series.
     */
    var blank = [];
    for (var i = 0; i < data[0].length; i++) {
        blank.push(null);
    }

    var first = true;
    var data_index = 0;
    for (var offset = 0; offset < series.length; offset++) {
        var t = series[offset][0];
        var val = series[offset][1];

        /*
         * Special case for adding the first time (when no other data series
         * is present): move the timestamp of the "0" element forward.
         */
        if (first && data.length == 1) {
            data[0][0] = t;
        }
        first = false;

        while (true) {
            var current_t_data = data[data_index][0];
            var delta = t - current_t_data;

            if (delta > 0.001) {
                /*
                 * If the value is ahead in the series, we must still
                 * maintain the size of the arrays (by appending a null).
                 */
                if (data[data_index].length == blank.length) {
                    data[data_index].push(null);
                }
                data_index++;

                /*
                 * Case of appending at the very end (adding a new row, with
                 * only a value for this serie).
                 */
                if (data_index >= data.length) {
                    var new_row = blank.slice(0);
                    new_row[0] = t;
                    new_row.push(val);

                    data.push(new_row);
                    break;
                }
                continue;
            } else if (delta < -0.001) {
                /*
                 * If we have found the proper spot but it does not match
                 * any other time value, then create a new row and insert it
                 * here. All other values are null.
                 */
                var new_row = blank.slice(0);
                new_row[0] = t;
                new_row.push(val);

                data.splice(data_index, 0, new_row);
                break;
            } else {
                /*
                 * If we have found an existing row, just append the value
                 * at the end of it.
                 */
                data[data_index].push(val);
                break;
            }
        }
    }

    /*
     * Pad the new series in case it does not run as long as the other series.
     */
    if (data_index > 0 || data.length == 1) {
        data_index++;
    }
    for (; data_index < data.length; data_index++) {
        data[data_index].push(null);
    }
}

/*
 * Filter a series.
 */
function filterData(series, valid)
{
    var result = [];

    var valid_index = 0
    var t_valid = valid[valid_index][0];
    var v_valid = valid[valid_index][1];
    for (var index = 0; index < series.length; index++) {
        var t = series[index][0];
        var v = series[index][1];

        while (valid_index + 1 < valid.length && t_valid < t) {
            valid_index++;
            t_valid = valid[valid_index][0];
            v_valid = valid[valid_index][1];
        }

        /*
         * The "valid" series is shorter, stop here.
         */
        if (t_valid < t) {
            break;
        }

        console.assert(t == t_valid, "t != t_valid");
        // TODO: Filtering should be customizable to a set of values, not just 0.
        if (v_valid == 0) {
            result.push([t, v]);
        }
    }

    return result;
}

/*
 * Decode a blob.
 */
function decodeData(dataview, offset, type)
{
    var result = [];
    for (; offset < dataview.byteLength; ) {
        var t = dataview.getFloat64(offset, true);
        offset += 8

        // TODO: Optimize with functions w/o switch().
        switch (type) {
        case "u8":
            var val = dataview.getUint8(offset, true);
            offset += 1;
            break;
        case "s8":
            var val = dataview.getInt8(offset, true);
            offset += 1;
            break;
        case "u16":
            var val = dataview.getUint16(offset, true);
            offset += 2;
            break;
        case "s16":
            var val = dataview.getInt16(offset, true);
            offset += 2;
            break;
        case "u32":
            var val = dataview.getUint32(offset, true);
            offset += 4;
            break;
        case "s32":
            var val = dataview.getInt32(offset, true);
            offset += 4;
            break;
        case "u64":
            var val = dataview.getBigUint64(offset, true);
            offset += 8;
            break;
        case "float":
            var val = dataview.getFloat32(offset, true);
            offset += 4;
            break;
        case "double":
            var val = dataview.getFloat64(offset, true);
            offset += 8;
            break;
        }

        result.push([t, val]);
    }

    return result;
}

/*
 * Fetch a series from the database.
 */
var xhr_time;
function fetchData(label, callback, param)
{
    /*
     * Check the cache first.
     */
    if (label in g_state.cache) {
        if (callback != null) {
            callback(param);
        }
        return;
    }

    /*
     * Evict a cache entry if needed.
     */
    if (g_state.cacheEntries.length == 25) {
        var evict = g_state.cacheEntries.splice(-1, 1);
        delete g_state.cache[evict];
    }

    /*
     * Otherwise actually fetch the data.
     */
    xhr_time = new Date();
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/fetch.py?d=" + g_dataset.datasetId + "&key=" + label, true);
    request.responseType = 'arraybuffer';

    request.onload = function(e) {
        if (this.status == 200) {
            var t2 = new Date();
            if (has_compression()) {
                var inStream = new LZMA.iStream(this.response);
                var outStream = LZMA.decompressFile(inStream);
                var decompressed = outStream.toUint8Array();
                var dataview = new DataView(decompressed.buffer);
            } else {
                var dataview = new DataView(this.response);
            }
            var t3 = new Date();
            var offset;
            var type = "";
            for (offset = 0; offset < dataview.byteLength; offset++) {
                var c = String.fromCharCode(dataview.getUint8(offset, true));
                if (c == '\n') {
                    break;
                }
                type += c;
            }

            g_state.cacheEntries.unshift(label);
            g_state.cache[label] = decodeData(dataview, offset + 1, type);
            var t4 = new Date();

            if (has_profiling()) {
                console.log("postal - http: " + (t2 - xhr_time) + "ms");
                console.log("postal --- size: " + this.response.byteLength);
                console.log("postal - lzma: " + (t3 - t2) + "ms");
                console.log("postal - decode: " + (t4 - t3) + "ms");
                console.log("postal --- total points: " + g_state.cache[label].length);
                console.log("postal --- total size: " + dataview.byteLength);
                console.log("postal - cache size: " + g_state.cacheEntries.length);
                console.log("postal --- cache entries: " + g_state.cacheEntries);
            }
        }

        if (callback != null) {
            callback(param);
        }
    };

    request.send();
}

function plotData(label, callback, param)
{
    const hasValid = label in g_dataset.valid_map;
    if (hasValid) {
        var valid = g_dataset.valid_map[label];
    }

    function mergeAndPlot()
    {
        var t1 = new Date();
        mergeData(g_state.data, g_state.cache[label]);

        var t2 = new Date();
        if (hasValid) {
            var filteredSeries = filterData(g_state.cache[label],
                                            g_state.cache[valid]);
        } else {
            var filteredSeries = g_state.cache[label];
        }

        var t3 = new Date();
        mergeData(g_state.filteredData, filteredSeries);
        var t4 = new Date();

        if (has_profiling()) {
            console.log("postal - merge1: " + (t2 - t1) + "ms");
            console.log("postal - filter: " + (t3 - t2) + "ms");
            console.log("postal - merge2: " + (t4 - t3) + "ms");
        }

        if (g_state.numVisible == 0) {
            /*
             * Refresh annotations when plotting the first series.
             * TODO: Does not appear to properly redraw anymore. Move this.
             */
            var show_annotations = document.getElementById("show_annotations");
            showAnnotations(show_annotations.checked);
        }

        /*
         * Inhibit the cache.
         */
        if (g_state.live) {
            g_state.cache = {};
            g_state.cacheEntries = [];
        }

        if (callback != null) {
            callback(param);
        }
    }

    fetchData(label, function() {
        if (hasValid) {
            fetchData(valid, mergeAndPlot, null);
        } else {
            mergeAndPlot();
        }
    }, null);
}

function getIndex(label)
{
    for (var index = 3; index < g_state.options.labels.length; index++) {
        if (g_state.options.labels[index] == label) {
            return index;
        }
    }
    return -1;
}

function removeFromPlot(label)
{
    var index = getIndex(label)
    if (index == -1) {
        return;
    }

    g_state.options.labels.splice(index, 1);
    g_state.options.visibility.splice(index - 1, 1);
    g_state.options.series[label] = {};

    for (var i = 0; i < g_state.data.length; i++) {
        g_state.data[i].splice(index, 1);
        if (i < g_state.filteredData.length) {
            g_state.filteredData[i].splice(index, 1);
        }
    }
}

function sortAnnotations()
{
    g_state.sortedAnnotations = [];
    for(var key in g_state.annotations) {
        g_state.sortedAnnotations.push(parseFloat(key));
    }
    g_state.sortedAnnotations.sort();
}

function pushAnnotation(id, xval, text)
{
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/annotate.py?" + ("d=" + g_dataset.datasetId +
                                                  "&action=add" +
                                                  "&id=" + id +
                                                  "&t=" + xval +
                                                  "&text=" + encodeURIComponent(text)),
                 false);
    request.send();

    if (request.status == 200) {
    }
}

function updateAnnotation(id, xval, text)
{
    var request = new XMLHttpRequest();
    if (xval > 0) {
        request.open("GET", "cgi-bin/annotate.py?" + ("d=" + g_dataset.datasetId +
                                                      "&action=update" +
                                                      "&id=" + id +
                                                      "&t=" + xval +
                                                      "&text=" + encodeURIComponent(text)),
                     false);
    } else {
        request.open("GET", "cgi-bin/annotate.py?" + ("d=" + g_dataset.datasetId +
                                                      "&action=delete" +
                                                      "&id=" + id),
                     false);
    }
    request.send();

    if (request.status == 200) {
    }
}

function buildDataset(datasetId, rawDataset)
{
    result = {};
    result.datasetId = datasetId;

    /*
     * Fetch column names (keys).
     */
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/fetch-columns.py?d=" + datasetId, false);
    request.send();

    if (request.status == 200) {
        result.labels = JSON.parse(request.responseText).sort();
    }
    result.enums = rawDataset.enums;
    result.valid_map = {};
    if ('valid_map' in rawDataset) {
        result.valid_map = rawDataset.valid_map;
    }

    /*
     * Fetch annotations.
     */
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/fetch-annotations.py?d=" + datasetId, false);
    request.send();

    result.annotations = {};
    if (request.status == 200) {
        try {
            dict = JSON.parse(request.responseText);
        } catch(e) {
            dict = {};
        }
        for (var xval in dict) {
            result.annotations[parseFloat(xval)] = [dict[xval].id, dict[xval].text, true];
        }
    }

    return result;
}

function buildState(dataset)
{
    var numItems = dataset.labels.length;

    result = {};
    result.datasetId = dataset.datasetId;
    result.plot = [];
    for (var i = 0; i < numItems; i++) {
        result.plot.push(0);
    }
    result.numVisible = 0;
    result.numVisibleOnRight = 0;
    result.legendDirection = 1;
    result.filter = true;
    result.highlight = false;
    result.annotate = false;
    result.live = false;
    result.timerId = null;
    result.annotationTimerId = null;
    result.last_palette_element_index = -1;
    result.palette_index = -1;

    result.data = [[0, 0, 0]];
    result.filteredData = [[0, 0, 0]];
    result.cache = {};
    result.cacheEntries = [];
    result.annotations = dataset.annotations;
    result.sortedAnnotations = null;
    result.options = buildOptions();

    return result;
}

var g_hairlines;
function buildHairlines()
{
    g_hairlines = new Dygraph.Plugins.Hairlines({
        divFiller: function(div, data) {
            var legend = $(".hairline-legend", div)
            var xval = parseFloat(data.hairline.xval);
            if (!isFinite(xval)) {
                return;
            }
            div.id = "ann_" + xval;

            /*
             * Avoid collisions by conservatively moving the annotation bubble
             * vertically.
             */
            var offset = (g_state.sortedAnnotations.indexOf(xval) % 10) * 25;
            div.style.top = "calc(100% - 50px - " + offset + "px)";

            var html = "";
            if (g_state.annotations[data.hairline.xval][2]) {
                var state = "locked";
                var hidden = "hidden";
                $(div).draggable('disable');
            } else {
                var state = "unlocked";
                var hidden = "";
                $(div).draggable('enable');
            }
            html +=
                "<abbr title='Lock/unlock the annotation for editing'>" +
                "<img id='lock_" + xval + "' src='contents/icons/" + state + ".png' " +
                "width='12px' onclick='lockAnnotation(" + xval + ")'></abbr>&nbsp;&nbsp;" +
                "<abbr title='Delete the annotation'>" +
                "<img id='kill_" + xval + "' class='hairline-kill-button' src='contents/icons/delete.png' " +
                "width='12px' " + hidden + "></abbR>&nbsp;&nbsp;" +
                "<abbr title='Edit the annotation'>" +
                "<img id='edit_" + xval + "' src='contents/icons/edit.png' " +
                "width='12px' onclick='editAnnotation(" + xval + ")' " + hidden + "></abbr>" +
                "&nbsp;&nbsp;<abbr title='Unlock then drag the label to move the annotation'>" +
                g_state.annotations[data.hairline.xval][1] + "</abbr>";

            legend.html(html);
        }
    });
}

function buildOptions()
{
    buildHairlines();

    /*
     * IMPORTANT NOTE: Anything added here must be considered for sharelinks.
     * When adding a new option, consider any special treatment for it in
     * share(), and make sure that the value is always restored, this might have
     * to be done in main_with_sharelink().
     */

    var options = {
        axes: {
            /*
             * X-axis labels are formatted with a special handler.
             */
            x: {
                axisLabelFormatter: timeFormatter,
            },
            /*
             * Always draw y2 to avoid redraw bug.
             * Make y2 use its own ticker's granularity, and default to no ticks.
             */
            y: {
                drawAxis: true,
            },
            y2: {
                drawAxis: true,
                independentTicks: true,
                ticker: noTicks,
            },
        },
        gridLineColor: "rgb(192,192,192)",
        showRangeSelector: false,

        /*
         * Prevent panning away too far.
         */
        panEdgeFraction: 0.1,

        /*
         * Pad the Y range so we can always see the min/max values with ease.
         */
        yRangePad: 50,

        /*
         * Display numbers with many digits if needed.
         */
        maxNumberWidth: 30,
        digitsAfterDecimal: 9,

        /*
         * Do not show gaps in the drawn line.
         */
        connectSeparatedPoints: true,

        /*
         * Legends are formatted with a special handler.
         */
        legend: "always",
        legendFormatter: legendFormatter,

        /*
         * Hovering on a plot highlights the whole plot.
         */
        highlightSeriesOpts: null,
        highlightSeriesBackgroundAlpha: 1,

        /*
         * Do not draw data points by default.
         */
        drawPoints: false,
        pointSize: 3,

        /*
         * Callback for data copy.
         */
        pointClickCallback: copyPoint,

        labels: ["t", "_dummy1", "_dummy2"],
        visibility: [0, 0],
        series: {
            "_dummy1": {
                axis: "y",
            },
            "_dummy2": {
                axis: "y2",
            },
        },

        plugins: [
            g_hairlines,
        ],
    };

    if (has_profiling()) {
        options.timingName = "dygraph";
    }

    return options;
}

function createPlot(state)
{
    return new Dygraph(document.getElementById("graph"),
                       state.filter ? state.filteredData : state.data,
                       state.options);
}

function onReady()
{
    /*
     * Build the selection bar the first time.
     */
    refreshSelect("");

    /*
     * Hook up events for annotations.
     */
    $(g_hairlines).on({
        'hairlineMoved': function(e, data) {
            // XXX: Handle collisions?
            if (data.newXVal != data.oldXVal) {
                g_state.annotations[data.newXVal] = g_state.annotations[data.oldXVal];
                delete g_state.annotations[data.oldXVal];
            }
            sortAnnotations();

            /*
             * Delay the update to the server. This is to coalesce successive
             * moves of the annotation.
             * XXX: Handle back-to-back updates
             */
            clearTimeout(g_state.annotationTimerId);
            g_state.annotationTimerId = setTimeout(function() {
                var id = g_state.annotations[data.newXVal][0];
                var text = g_state.annotations[data.newXVal][1];
                updateAnnotation(id, data.newXVal, text);
            }, 1000);
        },
        'hairlineDeleted': function(e, data) {
            var id = g_state.annotations[data.xval][0];
            updateAnnotation(id, -1, null);
            delete g_state.annotations[data.xval];
            sortAnnotations();
        }
    });

    /*
     * Refresh annotations.
     */
    var show_annotations = document.getElementById("show_annotations");
    showAnnotations(show_annotations.checked);

    forceRepositionLegend();
}

var g_dataset;
var g_state;
var g_plot;
function main_common()
{
    /*
     * Instantiate the plot.
     */
    g_plot = createPlot(g_state);

    g_plot.ready(function() {
        onReady();
    });
}

function main_with_dataset(datasetId)
{
    if ("restricted" in g_rawDataset && g_rawDataset['restricted']) {
        alert("You do not have permissions to access this dataset");
        return;
    }

    /*
     * Build the (optimized) dataset and the state.
     */
    g_dataset = buildDataset(datasetId, g_rawDataset);
    g_state = buildState(g_dataset);
    sortAnnotations();

    main_common();
}

/*
 * Adapted from
 * https://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically
 */
function merge_options(obj1, obj2)
{
    var obj3 = {};
    for (var attrname in obj1) {
        obj3[attrname] = obj1[attrname];
    }
    for (var attrname in obj2) {
        obj3[attrname] = obj2[attrname];
    }
    return obj3;
}

function main_with_sharelink()
{
    if ("restricted" in g_rawDataset && g_rawDataset['restricted']) {
        alert("You do not have permissions to access this dataset");
        return;
    }

    g_dataset = buildDataset(g_state.datasetId, g_rawDataset);

    /*
     * Patch up state/options.
     *
     * Part 1: Reconstruct deductible state.
     * XXX: Deduplicate with buildState, please.
     */
    fresh_options = buildOptions();
    const do_labels = !("labels" in g_state.options);
    const do_visibility = !("visibility" in g_state.options);
    g_state.options = merge_options(fresh_options, g_state.options);

    /*
     * Add good defaults for options that are absent.
     */
    if (!("filter" in g_state)) {
        g_state.filter = true;
    }
    if (!("annotate" in g_state)) {
        g_state.annotate = false;
    }
    if (!("highlight" in g_state)) {
        g_state.highlight = false;
    }
    if (!("legendDirection" in g_state)) {
        g_state.legendDirection = 1;
    }

    /*
     * Recompute the labels list if absent.
     */
    if (do_labels) {
        g_state.options.labels = ["t", "_dummy1", "_dummy2"];

        for (var series in g_state.options.series) {
            if (series == "_dummy1" || series == "_dummy2") {
                continue;
            }

            g_state.options.labels.push(series);
        }
    }

    /*
     * Recompute the visibility list if absent. Update the visibility counters.
     */
    if (do_visibility) {
        g_state.options.visibility = [false, false];
        g_state.numVisible = 0;
        g_state.numVisibleOnRight = 0;
        for (var i = 3; i < g_state.options.labels.length; i++) {
            g_state.options.visibility.push(true);
            if (g_state.options.series[g_state.options.labels[i]].axis == "y") {
                g_state.numVisible++;
            } else {
                g_state.numVisibleOnRight++;
            }
        }
    }

    /*
     * Add colors if needed.
     */
    if (!('palette_index' in g_state)) {
        g_state.palette_index = -1;
        g_state.last_palette_element_index = -1;
        for (var i = 3; i < g_state.options.labels.length; i++) {
            if (g_state.options.labels[i] == "_dummy1" ||
                g_state.options.labels[i] == "_dummy2") {
                continue;
            }

            g_state.options.series[g_state.options.labels[i]].color = getNextColor();
        }
    }

    /*
     * Recompute the plot list.
     */
    g_state.plot = [];
    for (var i = 0; i < g_dataset.labels.length; i++) {
        if (g_state.options.labels.indexOf(g_dataset.labels[i]) >= 0) {
            if (g_state.options.series[g_dataset.labels[i]].axis == "y") {
                g_state.plot.push(-1);
            } else {
                g_state.plot.push(1);
            }
        } else {
            g_state.plot.push(0);
        }
    }

    /*
     * Propagate legend/highlight options.
     * XXX: Deduplicate this code, please.
     */
    if (g_state.legendDirection) {
        g_state.options.legend = "always";
    } else {
        g_state.options.legend = "never";
    }
    if (g_state.highlight) {
        g_state.options.highlightSeriesOpts = {
            "strokeWidth": 2,
        };
        g_state.options.highlightSeriesBackgroundAlpha = 0.35;
    } else {
        g_state.options.highlightSeriesOpts = null;
        g_state.options.highlightSeriesBackgroundAlpha = 1;
    }

    /*
     * Make sure those silly entries are present.
     */
    g_state.options.series["_dummy1"] = {
        "axis": "y",
    }
    g_state.options.series["_dummy2"] = {
        "axis": "y2",
    }

    /*
     * Patch up state/options.
     *
     * Part 2: JavaScript objects.
     *
     * These should be merged from the fresh options above, but keep the code
     * below for compatibility with older sharelinks.
     */
    g_state.live = false;
    g_state.timerId = null;
    g_state.annotationTimerId = null;
    g_state.annotations = g_dataset.annotations;
    g_state.sortedAnnotations = null;
    sortAnnotations();
    g_state.options.axes.x.axisLabelFormatter = timeFormatter;
    if (g_state.numVisibleOnRight) {
        g_state.options.axes.y2.ticker = Dygraph.numericLinearTicks;
    } else {
        g_state.options.axes.y2.ticker = noTicks;
    }
    g_state.options.legendFormatter = legendFormatter;
    g_state.options.pointClickCallback = copyPoint;
    g_state.options.plugins = [
        g_hairlines
    ];
    if (has_profiling()) {
        g_state.options.timingName = "dygraph";
    }

    /*
     * Update checkboxes.
     */
    var legend_left = document.getElementById("legend_left");
    var legend_right = document.getElementById("legend_right");
    legend_left.checked = g_state.legendDirection == -1;
    legend_right.checked = g_state.legendDirection == 1;
    var show_points = document.getElementById("show_points");
    show_points.checked = g_state.options.drawPoints;
    var enable_filter = document.getElementById("enable_filter");
    enable_filter.checked = g_state.filter;
    var enable_highlights = document.getElementById("enable_highlights");
    enable_highlights.checked = g_state.highlight;
    var enable_rangesel = document.getElementById("enable_rangesel");
    enable_rangesel.checked = g_state.options.showRangeSelector;
    var show_annotations = document.getElementById("show_annotations");
    show_annotations.checked = g_state.annotate;

    /*
     * Fetch all the series using asynchronously triggered recursion.
     */
    $('#cover-spin').show(0);
    g_state.data = [[0, 0, 0]];
    g_state.filteredData = [[0, 0, 0]];
    g_state.cache = {};
    g_state.cacheEntries = [];
    function fetchNext(i) {
        if (i < g_state.options.labels.length) {
            plotData(g_state.options.labels[i], fetchNext, i + 1);
        } else {
            $('#cover-spin').hide(0);
            main_common();

            /*
             * Remove the zoom options, they are only used at initialization.
             */
            delete g_state.options.dateWindow;
            delete g_state.options.axes.y.valueRange;
            delete g_state.options.axes.y2.valueRange;
        }
    }
    fetchNext(3);
}

function loadState(shareId)
{
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/fetch-sharedata.py?s=" + shareId, false);
    request.send();

    if (request.status == 200) {
        g_state = JSON.parse(request.responseText);
        return g_state.datasetId;
    }
}

function loadMetadata(datasetId)
{
    var request = new XMLHttpRequest();
    request.open("GET", "cgi-bin/fetch-metadata.py?d=" + datasetId, false);
    request.send();

    if (request.status == 200) {
        g_rawDataset = JSON.parse(request.responseText);
    }
}
