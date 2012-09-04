/* jshint: */
/*global module buster ucss:true public_functions:true*/


var jsdom = require('jsdom');
var jQuery = require('jquery');
var fs = require('fs');
var async = require('async');
var http = require('http');
var url = require('url');
var sys = require('sys');
var rf = require('rimraf');


var ucss = {

    _read_file_http: function(file_url, ctx){
        var options = {
            host: url.parse(file_url).hostname,
            port: url.parse(file_url).port,
            path: url.parse(file_url).pathname
        }
        ,   downloadDir = __dirname + "/temp/"
        ,   file_name = url.parse(file_url).pathname.split('/').pop()
        ,   res       = !fs.existsSync(downloadDir) ? fs.mkdirSync(downloadDir) : undefined
        ,   file      = fs.createWriteStream(downloadDir + file_name);
        
        http.get(options, function(res) {
            res.on('data', function(data) {
                file.write(data);
            }).on('end', function() {
                file.end();
                ucss._findRules(file.path, ctx);
            });
// TODO timeout, request error handling
        });
    },

    _read_file_local: function (file_name, ctx){
        try {
            var css = fs.readFileSync(file_name).toString();
            ucss._foundRules += " " + css;
            ucss._findRules(css, ctx);        
        } catch (e) {
            console.log(e.message);
        }
    },
    
    _foundRules: "", // stores css rules from multiple files OR the command line arg -c
   
   /**
     * Find CSS rules in a CSS file
     * @param {String} css Path to CSS file, or CSS code
     * @param {Object} rules (optional) object to append found rules to.
     * @returns {Object} Object containing found rules, and number of
     *           occurences for each rule.
     */
    _findRules: function(css, ctx) {
        if (!css) ucss._processRules(css, ctx);

        if(css.indexOf("http") === 0){
            //console.log("downloading css file from remote ...");
            ucss._read_file_http(css, ctx);
            
        }else if (-1 === css.indexOf("{")) {
            //console.log("read local file: " + css);
            ucss._read_file_local(css, ctx);
            
        }else{
            // css only contains css rules (contents of style sheet files were load into the css variable)            
// TODO multiple remote files are not working as expected, total number of rules varies (randomly?)   
            ucss._asyncContext.processed += 1;
            var isAsyncFinished = ucss._asyncContext.required === ucss._asyncContext.processed; 
            if(isAsyncFinished){
                //console.log("all resources crawled for rules");
                
                // if rules are given by command line parameter => no rules collected so far.
                if(!ucss._foundRules) ucss._foundRules = css;
                
                // remove temp download directory that was used to download the css files
                if(fs.existsSync(__dirname+"/temp")) rf.sync(__dirname+"/temp");
                
                ucss._processRules(ucss._foundRules, ctx);
            }else{
                //console.log("crawling rules ..., " + ucss._asyncContext.processed + " resources processed");
            }
        }
    },
    
    _processRules: function(css, ctx){
        //console.log("processing found rules");
        
        // Replace newlines and other whitespace with single space
        css = css.replace(/\s+/g, " ");

        // Remove comments
        css = css.replace(/\/\*.+?\*\//g, "");

        var rule
        ,   pattern = new RegExp("(?:^|})(.*?)(?:{|$)" , "g")
        ,   rules = []
        ,   result = { used: {}, duplicates: {} }
        ,   foundRules = {};

        // Add each found rule, and count occurences
        while ((rule = pattern.exec(css))) {
            if (rule && rule[1]) {
                var r = rule[1].trim();
                if (undefined === foundRules[r]) {
                    foundRules[r] = 1;
                } else {
                    foundRules[r]++;
                }
            }
        }
        
        if (!foundRules) return null;

        // filter foundRules and count duplicate rules
        for (rule in foundRules) {
            if ("" === rule) continue;
            rules.push(rule);
            if (foundRules[rule] > 1) {
                result.duplicates[rule] = foundRules[rule];
            }
        }        
        
        ucss._processHtml(rules, ctx, result);
    },
    
    // TODO maybe this could be implemented with one of the async functions (https://github.com/caolan/async#until)
    _asyncContext:{
        processed: 0, // nr of already processed css resources
        required: undefined // nr of resources that have to be processed
    },
    _initAsync: function(required){
        ucss._asyncContext.processed = 0;
        ucss._asyncContext.required  = required;
    },    
    
    _processHtml: function(rules, ctx, result){    
        var cookie =    ctx.cookie;
        var donecb =    ctx.donecb;
        var whitelist = ctx.whitelist;
        var html =      ctx.html;
        
        // If cookie is provided, duplicate all html instances, and add login
        // info to one of each.
        var items = [];
        if (cookie) {
            for (var i=0;i<html.length;i++) {
                items.push({ html: html[i], cookie: "" });
                items.push({ html: html[i], cookie: cookie });
            }
        } else {
            items = html;
        }

        // Search html for rules
        async.forEach(items, function(item, callback) {
            var html = item.html ? item.html : item
            ,   cookie = item.cookie ? item.cookie : "";

            jsdom.env({
                html: html,
                headers: { 'Cookie': cookie },
                done: function(errors, window) {
                    var $ = jQuery.create(window);
                    for (var i=0; i<rules.length; i++) {
                        var rule = rules[i];

                        // If current rule is whitelisted, skip.
                        if (whitelist && -1 < whitelist.indexOf(rule)) continue;
                        if (-1 < rule.indexOf("@")) continue;

                        if (rule) {
                            var oRule = rule;

                            // Add rule to index, if not already added
                            if (undefined === result.used[oRule]) {
                                result.used[oRule] = 0;
                            }

                            // Remove pseudo part of selector
                            rule = rule.split(":")[0];

                            // Check if rule is used
                            try {
                                if ($(rule).length > 0) {
                                    result.used[oRule] = result.used[oRule]
                                        + $(rule).length;
                                }
                            } catch (e) {
                                console.log("Problem with selector: " + oRule);
                            }
                        }
                    }
                    callback();
                }
            });
        }, function(err) { if (donecb) donecb(result); });
    },
    
    /**
     * Search for rules in HTML.
     * @param {Array} css Array of strings (containing CSS rules), or an
     *         array of paths to CSS files.
     * @param {Array} html Html to search through. This can be either an array
     *         of Strings (containing html code), an array of URLs to visit, or
     *         an array of paths to html files.
     * @param {String} cookie Cookie to use for login, on the form
     *         "sessionid=foo". Each url in the html parameter will
     *         be visited both with and without the cookie.
     * @param {Function} donecb Callback for when done. Should take a result
     *         object as argument.
     */
    search: function(css, html, cookie, whitelist, donecb) {
        if ((html == false || css == false)) {
            donecb({});
            return null;
        }

        var self = this
        ,   context = {
                "cookie":        cookie,
                "whitelist":     whitelist,
                "donecb":        donecb,
                "html":          html
            };
        ucss._foundRules = "";

        // Find all rules
        ucss._initAsync(css.length);
        for (var i=0; i<css.length; i++) {
            ucss._findRules(css[i], context);
        }
    }        
};


module.exports = {
    /**
     * Analyze CSS: Find number of times a rule has been used, and if there are
     * duplicates.
     *
     * @param {String} cssPath Path to css file
     * @param {String} html Html code or URL to html code.
     * @param {Object} auth (optional) Login info on the form
     *         {username: "", password: "", loginUrl: "", loginFunc: ""}
     *         where loginFunc can be a function, or the name of a
     *         login helper (see loginhelpers.js).
     * @param {Function} done Function to execute when done. An object on the
     *         form { "<rule>": count } is passed to it, where count is the
     *         number of occurnces of <rule>.
     */
    analyze: function(css, html, whitelist, auth, done) {
        if (!(html instanceof Array)) html = [html];
        if (!(css instanceof Array)) css = [css];

        // Default result handler
        done = done ? done : function(result) {
            console.log("\nresult: ", result);
        };

        // If login info is given, do login.
        if (auth) {
            var loginFunc;
            var username = auth.username;
            var password = auth.password;
            var loginUrl = auth.loginUrl;

            if (!(auth.loginFunc instanceof Function)) {
                loginFunc = require('./helpers/login')[auth.loginFunc];
            } else {
                loginFunc = auth.loginFunc;
            }

            loginFunc(loginUrl, username, password, function(cookie) {
                ucss.search(css, html, cookie, whitelist, done);
            });
        } else {
            ucss.search(css, html, null, whitelist, done);
        }
    }
};
