
exports.createInfoPanel = function (torTitle, subTitle, status, userCount) {

    let createMultiChar = function (size, string) {
        let result = "";
        for (i = 0 ; i < size ; i++) {
            result += string;
        }
        return result;
    };

    let createTextRow = function (text, width) {

        if (text.length + 3 >= width) {
            text = text.substring(0, width-9);
            text += "...";
        }

        if (text.length % 2 !== 0) {
            text += " "
        }

        spacing = ((width - text.length) / 2) - 1;

        result = "|";
        result += createMultiChar(spacing, " ");
        result += text;
        result += createMultiChar(spacing, " ");
        result += "|";

        return result;
    };

    let createEmptyRows = function (amount, width) {
        result = "";
        for (i = 0 ; i < amount -1 ; i++) {
            result += createTextRow("", width);
            result += "\n";
        }
        result += createTextRow("", width);
        return result;
    };

    let width = process.stdout.columns;
    let height = process.stdout.rows;

    width = (width === undefined) ? 100 : width;
    height = (height === undefined) ? 20 : height;

    if (subTitle === "-")
        subTitle = "No subtitles";
    if (torTitle === "-")
        torTitle = "No torrent specified";

    console.log('\033c');
    //console.log(createMultiChar(Math.floor((height - 15)/2), "\n"));
    console.log(createMultiChar(15, "\n"));
    console.log(" " + createMultiChar(width - 2, "-"));
    console.log(createTextRow("RASPPI-REMOTE SERVER", width));
    console.log(createEmptyRows(1, width));
    console.log(createTextRow("Connected users: " + userCount, width));
    console.log(createEmptyRows(1, width));
    console.log(createTextRow(status, width));
    console.log(createEmptyRows(1, width));
    console.log(createTextRow("Title: " + torTitle, width));
    console.log(createTextRow("Subtitles: " + subTitle, width));
    console.log(createEmptyRows(1, width));
    console.log(" " + createMultiChar(width - 2, "-"));
};

