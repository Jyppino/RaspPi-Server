process.on('uncaughtException', err => {
    console.log("Caught Exception: " + err);
});


let x = 8 / 0;
throw new Error();


console.log("Test");