/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var fs = require("fs");
var path = require("path");
var tmp = require("tmp");
var spawn = require("child_process").spawn;
var glob = require("glob");

var phantom = require('phantomjs-prebuilt');
var soziExportFrames = path.join(__dirname, "export-frames.js");
var soziExportVideo = path.join(__dirname, "export-video.js");

function setOutputFileName(inputFileName, options, ext) {
    if (!options.output) {
        if (options.images) {
            options.output = path.dirname(inputFileName);
        }
        else {
            var inputExt = path.extname(inputFileName).slice(1);
            options.output = inputFileName.replace(new RegExp(inputExt + "$"), ext);
        }
    }
}

exports.convertToPDF = function (inputFileName, options) {
    // If not set, compute the output file name from the input file name
    setOutputFileName(inputFileName, options, "pdf");

    console.log("Converting " + inputFileName + " to " + options.output);

    // Create a temporary directory.
    // Force deletion on cleanup, even if not empty.
    var tmpDir = tmp.dirSync({unsafeCleanup: true}).name;

    // Play the presentation and export each frame to its own file
    var p = phantom.exec(soziExportFrames, inputFileName, tmpDir,
        options.width * options.resolution,
        options.height * options.resolution,
        options.pngCompression,
        options.include, options.exclude);

    p.stdout.pipe(process.stdout);
    p.stderr.pipe(process.stderr);

    p.on("exit", function (code) {
        var pdfjamOptions = [
            // The desired page size
            "--paper", options.paper,
            // Fit images to pages, do not override page size
            "--rotateoversize", false,
            // Page orientation
            options.portrait ? "--no-landscape" : "--landscape",
            // Output PDF file name
            "--outfile", options.output
        ].concat(
            // The list of files to join
            glob.sync(path.join(tmpDir, "*.png")),
            // Keep the first page of each document
            1
        );

        // Join all frames into a single PDF document
        var child = spawn("pdfjam", pdfjamOptions, {stdio: "inherit"});
        child.on("error", err => {
            console.log("ERROR: pdfjam executable not found. Check that texlive-extra-utils is installed.");
        });
    });
};

exports.convertToPPTX = function (inputFileName, options) {
    // If not set, compute the output file name from the input file name
    setOutputFileName(inputFileName, options, "pptx");

    console.log("Converting " + inputFileName + " to " + options.output);

    // Create a temporary directory.
    // Force deletion on cleanup, even if not empty.
    var tmpDir = tmp.dirSync({unsafeCleanup: true}).name;

    // Play the presentation and export each frame to its own file
    var p = phantom.exec(soziExportFrames, inputFileName, tmpDir,
        options.width * options.resolution,
        options.height * options.resolution,
        options.pngCompression,
        options.include, options.exclude);

    p.stdout.pipe(process.stdout);
    p.stderr.pipe(process.stderr);

    p.on("exit", function (code) {
        // Join all frames into a single PPTX document
        var pptx = require("officegen")("pptx");

        pptx.on("finalize", function (written) {
            console.log("Finished creating PowerPoint file: " + options.output );
        });
        pptx.on("error", function (err) {
            console.log(err);
        });
		
		if(options.wide){
			pptx.setWidescreen(true);
		}
		
        fs.readdirSync(tmpDir).forEach(function(file) {
            var slide = pptx.makeNewSlide();
            slide.addImage(path.join(tmpDir, file), {y: 0, x: 0, cy: "100%", cx: "100%" });
        });
        var out = fs.createWriteStream(options.output);
        out.on("error", function(err) {
            console.log(err);
        });
        pptx.generate(out);
    });
};

exports.convertToVideo = function (inputFileName, options) {
    // If not set, compute the output file name from the input file name
    setOutputFileName(inputFileName, options, "ogv");

    console.log("Converting " + inputFileName + " to " + options.output);

    // Create a temporary directory.
    // Force deletion on cleanup, even if not empty.
    var tmpDir = options.images ? options.output : tmp.dirSync({unsafeCleanup: true}).name;

    // Play the presentation and export each animation step to its own file
    var p = phantom.exec(soziExportVideo,
        inputFileName, tmpDir,
        options.width, options.height, options.pngCompression);

    p.stdout.pipe(process.stdout);
    p.stderr.pipe(process.stderr);

    var ffmpegOptions = [
        // Frames per second
        "-r", 50,
        // Convert a sequence of image files
        "-f", "image2",
        // The list of image files
        "-i", path.join(tmpDir, "img%d.png"),
        // The video bit rate
        "-b:v", options.bitRate,
        // Overwrite the output file without asking
        "-y",
        // The name of the output video file
        options.output
    ];

    if (!options.images) {
        p.on("exit", function (code) {
            // Join all images to a single video
            var child = spawn("ffmpeg", ffmpegOptions, {stdio: "inherit"});
            child.on("error", err => {
                console.log("INFO: ffmpeg executable not found. Trying avconv.");
                child = spawn("avconv", ffmpegOptions, {stdio: "inherit"});
                child.on("error", err => {
                    console.log("ERROR: Could not run ffmpeg or avconv. Check that FFMPEG or libav is installed.")
                });
            });
        });
    }
};
