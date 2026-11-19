// The id of a criterion, in the one form of qory's acceptance criteria format: ac- and a
// number from 1 to 9999 with no leading zero, such as ac-3. NUMBER is the number alone, for
// a pattern that finds the id inside a longer line.
'use strict';

const NUMBER = '[1-9][0-9]{0,3}';

const CRITERION_ID = new RegExp(`^ac-${NUMBER}$`);

module.exports = { NUMBER, CRITERION_ID };
