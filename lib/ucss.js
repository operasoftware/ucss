/* global module */

var Q = require('q');


var ucss = {
    /**
     * @param {Object} pages
     * @param {String} pages.crawl URL to starting point of crawl.
     * @param {String} pages.include HTML instances to include, given
     *                 as a string of HTML, an URL or a path.
     *                 Useful for checking single files, in addition to
     *                 crawling (or if just a set of pages are to be
     *                 checked.
     * @param {String} pages.exclude Pages or subdomains to exclude.
     * @param {Array|String} css A CSS string, or an array of CSS
     *                 resources (strings, paths, or URLs).
     * @param {Object} context
     * @param {Array}  context.whitelist List of selectors to ignore
     * @param {Object} context.cookie Cookie to use for login, on the form
     *         "sessionid=foo". Each uri in the html parameter will
     *         be visited both with and without the cookie.
     * @param {Function} doneCallback Function to execute when done. An object on the
     *         form { "<selector>": count } is passed to it, where count is the
     *         number of occurnces of <selector>.
     */
    search: function(pages, css, context, doneCallback) {
        var cssHandler = require('../lib/css');
        var htmlHandler = require('../lib/html');

        var cookie = context.cookie;
        var whitelist = context.whitelist;
        var result = { used: {}, duplicates: {}, ignored: {} };

        Q.fcall(function() {
            return cssHandler.getSelectors(css);
        })
        .then(function(fulfillment) {
            result.duplicates = fulfillment.duplicates;
            var selectors = fulfillment.selectors;

            return htmlHandler.matchSelectors(pages, selectors,
                                              cookie, whitelist);
        })
        .then(function(fulfillment) {
            result.used = fulfillment.used;
            result.ignored = fulfillment.ignored;
        })
        .fail(function(error) {
            console.error(error);
            process.exit(1);
        })
        .done(function () {
            doneCallback(result);
        });
    }
};


module.exports = {
    /**
     * Matches selectors in a set of CSS files against a set of HTML resources
     * to find how many times each rule has been used, and if rules are unused.
     * Also finds duplicate CSS rules.
     *
     * @param {Object} pages
     * @param {String} pages.crawl URL to starting point of crawl.
     * @param {String} pages.include HTML instances to include, given
     *                 as a string of HTML, an URL or a path.
     *                 Useful for checking single files, in addition to
     *                 crawling (or if just a set of pages are to be
     *                 checked.
     * @param {String} pages.exclude Pages or subdomains to exclude.
     * @param {Array|String} css A CSS string, or an array of CSS
     *                 resources (strings, paths, or URLs).
     * @param {Object} context
     * @param {Array}  context.whitelist List of selectors to ignore
     * @param {Object} context.auth Authentication information
     * @param {String} context.auth.username
     * @param {String} context.auth.password
     * @param {String} context.auth.loginUrl
     * @param {String|Function} context.auth.loginFunk Login function, or name
     *                 of function in lib/helpers/login.js.
     * @param {Function} done Function to execute when done. An object on the
     *         form { "<selector>": count } is passed to it, where count is the
     *         number of occurnces of <selector>.
     */
    analyze: function(pages, css, context, doneCallback) {
        // Ensure that doneCallback is callable:
        if (!doneCallback) {
            doneCallback = function(result) {
                console.log("\nresult: ", result);
            };
        }

        // Check that needed resources is available
        if (!pages) {
            console.log("No HTML given, nothing to do.");
            doneCallback({});
            return null;
        }
        if (undefined === pages.crawl && undefined === pages.include) {
            console.log("No HTML given, nothing to do.");
            doneCallback({});
            return null;
        }
        if (!css) {
            console.log("No CSS given, nothing to do.");
            doneCallback({});
            return null;
        }

        if (!context) {
            context = {};
        }

        // Make sure resources is given as lists
        if (pages.include) {
            if (!(pages.include instanceof Array)) {
                pages.include = [pages.include];
            }
        }
        if (pages.crawl) {
            if (!(pages.crawl instanceof Array)) {
                pages.crawl = [pages.crawl];
            }
        }
        if (pages.exclude) {
            if (!(pages.exclude instanceof Array)) {
                pages.exclude = [pages.exclude];
            }
        }
        if (!(css instanceof Array)) {
            css = [css];
        }

        var auth = context.auth ? context.auth : null;

        // If login info is given, do login.
        if (auth) {
            var loginFunc;
            var username = auth.username;
            var password = auth.password;
            var loginUrl = auth.loginUrl;

            if (auth.loginFunc instanceof Function) {
                loginFunc = auth.loginFunc;
            } else {
                loginFunc = require('./helpers/login')[auth.loginFunc];
            }

            loginFunc(loginUrl, username, password, function(cookie) {
                context.cookie = cookie;
                ucss.search(pages, css, context, doneCallback);
            });
        } else {
            ucss.search(pages, css, context, doneCallback);
        }
    }
};