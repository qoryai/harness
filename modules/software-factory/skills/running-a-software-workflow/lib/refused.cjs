// The characters that no string of software-factory contains, the rule that the JSON Schemas
// write out as ranges: each Cc, U+2028, U+2029, and each Cf but U+200C and U+200D (the joiners
// of emoji). A test compares the ranges of the schemas with this expression.
'use strict';

module.exports = /[\p{Cc}\u2028\u2029]|(?![\u200C\u200D])\p{Cf}/u;
