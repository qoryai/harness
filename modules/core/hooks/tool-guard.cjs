// The guard of a run's tool calls that the adapters for Claude Code and Codex share. Each
// runtime runs tool-guard-<runtime>.cjs before each tool call, and at each step of an agent
// for the step limit of step-limit.cjs. Only in a run, when QORY_RUN_ID is set, decide denies:
// - an agent started in the background, on Claude Code: an Agent or Task call with
//   run_in_background true. Codex starts every agent with spawn_agent, which returns at
//   once and has no such key, so decide lets spawn_agent run;
// - a write to a path under .qory/build/, where step-limit.cjs keeps the step counts, and a
//   chmod, chown, chgrp or chflags of .qory/ or a folder above it;
// - a write to a path that the lock lists, as checks.cjs lock --verify reads the lock;
// - a write below $QORY_HARNESS_HOME when it lies below the working folder, where the step
//   limit reads the tools of each agent;
// - a write of .reports/*.json and a shell command that reaches .reports/ other than checks.cjs
//   alone, by the rules of reports-guard.cjs, which Claude Code's settings and Codex lack;
// - a write from the main session, a call whose input has no agent_id, outside the
//   artifact folder. Both runtimes set agent_id only in a call of an agent that the session
//   started. A reviewer of a change, which qory starts as the main agent of its session, is
//   the other way round: when $QORY_HARNESS_HOME/inputs.json has the member qory.review, the
//   main session writes one path, qory.review.report, with a Write or an apply_patch that adds
//   it, and no other file, the artifact folder included. It denies by default, for the main
//   session and each agent: REVIEW_TOOLS, the report write and the commands of reviewShell
//   are all it allows, and it starts no agent. The guard denies the write tools (Write, Edit,
//   MultiEdit, NotebookEdit and apply_patch) to each agent of that session, whatever its type,
//   and to each agent whose type ends in -reviewer in any session but a review session, the
//   report path included, but for the one report file that the next entry allows. Outside a
//   reviewer session it does not run reviewShell for such an agent; the other rules of the
//   guard limit its shell;
// - a write by an agent of STEP_REVIEWERS, which reviews the file of a step inside a session,
//   but one: a Write or an apply_patch of reportPatch's form to
//   <artifacts>/.step-reports/<name>/<sha256>.json, with the agent's name as reportName reads
//   it, as stepReport reads the call. The sessions of qory.review, qory.review_session and
//   qory.hook_session allow no such write;
// - any other write whose path, after links and .. parts, has a folder .step-reports, matched
//   as a disk that ignores case does, and a shell command, other than one of read-only commands
//   and checks.cjs alone, whose text or a word of it has that folder, that writes in the folder
//   of the artifact folder, or that can write there with a word that reaches it;
// - in the session of a hook's agent, when inputs.json has the member qory.hook_session, the
//   rules of a reviewer session, with qory.hook_session.report as the one path that the main
//   session writes. These rules apply in place of those of qory.review and
//   qory.review_session. A value that is no object, or a report that is no normalised
//   absolute path, leaves the session no path to write. The shell runs only the commands of
//   reviewShell, so no qory command and no checks script;
// - in a review session, when inputs.json has the member qory.review_session as an object and
//   no qory.review object, as reviewSession reads it: each write of an agent whose type ends
//   in -reviewer but one, a Write or an apply_patch of reportPatch's form that writes
//   <reports>/<name>.json, where reports is qory.review_session.reports, outside the working
//   folder, and name the agent's name, as sessionReport and reportName read them: on Claude
//   Code from harness:<name>, on Codex a role of <home>/codex/agents/. Such an agent runs
//   only a shell command that readsOnlyCall passes. No other call, of the main session or an
//   agent of any type or none, writes in <reports>, by any tool, a shell command included,
//   and a command whose writes the guard does not read contains no path in it, except the
//   checks script alone with findings round, which reads the reports and writes no file. The
//   session starts agents, none in the background; the main session and every other agent
//   follow the rules of any other session outside <reports>;
// - in a review session, a write of <artifacts>/verification.json or of
//   <artifacts>/.reports/matrix-record.json, with <artifacts> as artifactFolder returns it:
//   only the verb matrix of the checks script writes them, so no call of the main session
//   or of an agent does, by a write tool or by a shell command with the path in its text,
//   and an extraction by tar or unzip into a folder above them counts as a write. A shell
//   command that is no read and names <artifacts> or .reports, or a folder above them as the
//   target of cd, -C, -d, -o or --directory, or runs in <artifacts>, is denied, as is each
//   write of a file in <artifacts>/<type>/<name>/v<N>/, a stored version, and versions.cjs
//   with a verb but compare, which would copy a stored version over the draft; other than the
//   checks script with a verb of ARTIFACT_VERBS, versions.cjs compare and the push of
//   PUSH_FORM. A command with the word push and the word verification, or a variable or a
//   substitution, is denied
//   unless it is PUSH_FORM and, for verification, from <artifacts>/verification.json. The
//   limits of the next entry apply: a path that a variable or code makes passes, except in a
//   push;
//   - shortcut: a locked check runs as a child process that the guard does not see, and can
//     rewrite both files or plant a record in .reports/runs/; replace the guard with qory
//     running the locked checks and matrix outside the session.
// - in a session with qory.review or qory.review_session, a write of the inputs.json of the
//   harness home, wherever the home lies, and, when the home lies outside the working folder,
//   every write below the home except qory.review.report, <reports> and a working folder
//   inside the home: the guards and the agents that qory composed. A command whose writes the
//   guard does not read, other than the checks script with a verb of REVIEW_VERBS, neither
//   runs in the home nor contains a word that reaches it, outside that working folder, except
//   the file of the home that it runs. A home in the working folder gets no such deny, so a
//   change of the harness's files can edit them. The checks of qory use the bytes that qory
//   wrote, not the file. The read-only mount of the home in a walled run is the main control;
//   the guard is the second. Its limits:
//   - shortcut: the guard reads the text of one call, so a path of the home, of the file or
//     of <reports> that a shell variable makes passes, as the next lines state, and so do a
//     script that one call writes and a later call runs (cat > /tmp/p.py, then python3
//     /tmp/p.py) and a path that code joins from parts ('ho' + 'me'). The mount covers them;
//     replace this check only if a review session runs without that mount.
//   - shortcut: a run of a file of the home passes only in a call with no quotes,
//     parentheses or $, so node <home>/x.cjs 'a b' is denied; widen it when a reviewer
//     needs such a call and the guard can tell the file that runs from the text it reads.
//   - shortcut: with the working folder inside the home, a shell write of a new name directly
//     in a folder of the home passes, as homeParts states; Write and Edit are denied. The
//     mount covers it; list the names when a review session runs without that mount.
// A write is a call of Write, Edit, MultiEdit or NotebookEdit, or a Codex apply_patch, with
// the paths of its file_path, notebook_path or patch; or a shell command whose text
// contains the path and writes, as WRITERS reads it. The guard gives a clear message for
// each form in which a locked path or .qory/build/ appears literally in the call, also
// after the shell removes quotes, expands braces and expands a ~ or ~/ at the start of a
// word to $HOME. It reads a shell command as text and runs no shell, so a write whose path
// only a variable, $HOME, ${HOME}, a ~user, a $( ... ), a backtick or eval makes passes, as
// in `D=lock; echo x > ${D}ed/f`. Verify's `lock --verify --version <N>` keeps the lock for
// that write, and the push check of build-ledger and the report checks keep the build
// ledger, whose copy is .reports/build-ledger.json, and the reports. No rule covers
// qory.yaml, .qory/ outside .qory/build/ and the harness home, the hooks or the modules
// outside a harness home below the working folder: agents may change them.
//
// The adapter lies at <home>/hooks/, and checks.cjs at
// <home>/modules/core/skills/running-a-workflow/checks.cjs, as end-gate.cjs lists.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { folder, inputsFile, qoryInputs, HOOK_SESSION } = require('./end-gate.cjs');
const steps = require('./step-limit.cjs');
const reportsGuard = require('./reports-guard.cjs');

// The tools that write files, with the keys of their input that contain a path.
const WRITE_TOOLS = { Write: ['file_path'], Edit: ['file_path'], MultiEdit: ['file_path'],
  NotebookEdit: ['notebook_path'] };
// The tools that start an agent on Claude Code.
const AGENT_TOOLS = new Set(['Agent', 'Task', 'spawn_agent']);
// The white space that Codex's patch parser trims from a line, as Rust's trim does: the
// characters of Unicode's White_Space. JavaScript's \s lacks U+0085 and adds U+FEFF.
const PATCH_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f' +
  '\\u205f\\u3000';
// The set of PATCH_SPACE, to match one character.
const PATCH_SPACE_CHAR = new RegExp(`[${PATCH_SPACE}]`);
// The starts of a line of a Codex patch that adds, changes, deletes or moves to a file. Codex
// trims white space from both ends of a line before it reads a header, and the path is the
// rest of the line after the header, its colon and one space.
const PATCH_HEADERS = ['*** Add File: ', '*** Update File: ', '*** Delete File: ',
  '*** Move to: '];
// The folder of the step counts, below the working folder.
const BUILD = path.join('.qory', 'build');
// The first line of a Codex patch, which apply_patch also takes through the shell.
const PATCH = '*** Begin Patch';

// The first line of each deny starts with what to do and has at most 100 characters.
const BACKGROUND = 'Start the agent with run_in_background false, or leave the key out.\n' +
  'An agent in the background can still run after the main session ends, so the guard ' +
  'denies it.';
const BUILT = 'Leave .qory/build/ as it is: the step limit keeps the step count of each ' +
  'agent there.\n';
const MAIN = 'Start an agent to change this file: the main session of a run changes no ' +
  'file here.\nThe main session writes only in the artifact folder, ';
// unread returns the deny of a write when the lock of type cannot be read, for problem.
const unread = ({ type, problem }) => `Run \`qory artifact pull${type ? ` ${type}` : ''}\`, ` +
  `then try again: the guard could not read the lock.\n${problem}`;
const CRASHED = 'Report this error in your output: the tool guard crashed.\n';
const HOMED = 'Leave the composed harness as it is: the step limit reads the tools of each ' +
  'agent from it.\nThe harness home is ';
const MODED = 'Leave the mode and owner of .qory/ and the folders above it as they are.\n' +
  'The step limit writes the step counts in .qory/build/; the command changes ';
const LINKED = 'Replace the link at the artifact folder with a folder: a link is no artifact ' +
  'folder.\nThe main session writes only in the artifact folder, and ';
const NO_ROOT = 'Start the session through qory: the tool guard found no working folder of ' +
  'the run.\nOn Claude Code it reads CLAUDE_PROJECT_DIR, and on Codex the folder of the hook.';
// The commands that read files and write none, each with the options that keep it so: short
// has the letters of its short options, valued those of them that take a value, and long its
// long options, each also as --<option>=<value>. short '*' allows every option, as for ls.
// Any other option makes the command opaque: rg --pre and sort --compress-program run a
// command, and sort -o, tree -o, file -C and date -s write. The primaries of find are in
// FIND_PRIMARIES.
const READ_ONLY = new Map(Object.entries({
  cat: { short: 'AbeEnstTuvl' },
  grep: { short: 'EFGPeifvwxyclLmoqsbHhnTZzrRaIUABCdDu0123456789', valued: 'efmABCdD',
    long: ['extended-regexp', 'fixed-strings', 'basic-regexp', 'perl-regexp', 'regexp', 'file',
      'ignore-case', 'no-ignore-case', 'invert-match', 'word-regexp', 'line-regexp', 'count',
      'color', 'colour', 'files-without-match', 'files-with-matches', 'max-count',
      'only-matching', 'quiet', 'silent', 'no-messages', 'byte-offset', 'with-filename',
      'no-filename', 'label', 'line-number', 'initial-tab', 'null', 'null-data',
      'after-context', 'before-context', 'context', 'text', 'binary-files', 'devices',
      'directories', 'exclude', 'exclude-from', 'exclude-dir', 'include', 'recursive',
      'dereference-recursive', 'line-buffered', 'binary'] },
  rg: { short: 'iSsFwxvcClnNHhoqLuUe.gtTmABCMjarEfpbI0', valued: 'egtTmABCMjrEf',
    long: ['files', 'files-with-matches', 'files-without-match', 'count', 'count-matches',
      'line-number', 'no-line-number', 'hidden', 'no-ignore', 'glob', 'iglob', 'type',
      'type-not', 'type-list', 'ignore-case', 'smart-case', 'case-sensitive', 'fixed-strings',
      'word-regexp', 'line-regexp', 'invert-match', 'max-count', 'max-depth', 'max-columns',
      'max-filesize', 'context', 'after-context', 'before-context', 'color', 'colors',
      'heading', 'no-heading', 'json', 'vimgrep', 'only-matching', 'quiet', 'follow',
      'multiline', 'multiline-dotall', 'pcre2', 'sort', 'sortr', 'stats', 'trim', 'text',
      'null', 'unrestricted', 'regexp', 'file', 'replace', 'passthru', 'column', 'no-filename',
      'with-filename', 'pretty', 'byte-offset', 'encoding', 'threads', 'no-messages', 'binary',
      'one-file-system'] },
  ls: { short: '*' },
  head: { short: 'ncqvz0123456789', valued: 'nc',
    long: ['lines', 'bytes', 'quiet', 'silent', 'verbose', 'zero-terminated'] },
  tail: { short: 'ncqvfFrbsz0123456789', valued: 'ncbs',
    long: ['lines', 'bytes', 'quiet', 'silent', 'verbose', 'follow', 'retry', 'pid',
      'sleep-interval', 'zero-terminated'] },
  wc: { short: 'clmwL', long: ['lines', 'bytes', 'chars', 'words', 'max-line-length', 'total'] },
  cmp: { short: 'bilsn', valued: 'in',
    long: ['print-bytes', 'ignore-initial', 'verbose', 'bytes', 'quiet', 'silent'] },
  echo: { short: 'neE' },
  printf: { short: '' },
  true: { short: '*' },
  false: { short: '*' },
  '[': { short: '*' },
  pwd: { short: 'LP' },
  which: { short: 'as' },
  type: { short: 'atpPf' },
  stat: { short: 'LfcxsrtlnqF',
    long: ['format', 'printf', 'dereference', 'file-system', 'terse'] },
  file: { short: 'bcdEhiIkLlNnprsvzZ0mfFeP', valued: 'mfFeP',
    long: ['brief', 'mime', 'mime-type', 'mime-encoding', 'dereference', 'no-dereference',
      'keep-going', 'raw', 'special-files', 'uncompress', 'files-from', 'separator', 'no-pad',
      'print0', 'exclude', 'extension', 'magic-file'] },
  basename: { short: 'asz', valued: 's', long: ['multiple', 'suffix', 'zero'] },
  dirname: { short: 'z', long: ['zero'] },
  realpath: { short: 'emqsLPz',
    long: ['canonicalize-existing', 'canonicalize-missing', 'quiet', 'strip', 'no-symlinks',
      'logical', 'physical', 'relative-to', 'relative-base', 'zero'] },
  readlink: { short: 'femnqsvz',
    long: ['canonicalize', 'canonicalize-existing', 'canonicalize-missing', 'no-newline',
      'quiet', 'silent', 'verbose', 'zero'] },
  date: { short: 'uRIdrjfvnz', valued: 'drfv',
    long: ['utc', 'universal', 'date', 'file', 'reference', 'rfc-2822', 'rfc-3339',
      'iso-8601', 'rfc-email', 'debug'] },
  sleep: { short: '' },
  cut: { short: 'bcdfnsz', valued: 'bcdf',
    long: ['bytes', 'characters', 'delimiter', 'fields', 'complement', 'only-delimited',
      'output-delimiter', 'zero-terminated'] },
  tr: { short: 'cdsCu', long: ['complement', 'delete', 'squeeze-repeats', 'truncate-set1'] },
  nl: { short: 'bdfhilnpsvw', valued: 'bdfhilnsvw',
    long: ['body-numbering', 'section-delimiter', 'footer-numbering', 'header-numbering',
      'line-increment', 'join-blank-lines', 'number-format', 'no-renumber',
      'number-separator', 'starting-line-number', 'number-width'] },
  sha256sum: { short: 'bctwz', long: ['binary', 'check', 'tag', 'text', 'zero',
    'ignore-missing', 'quiet', 'status', 'strict', 'warn'] },
  md5sum: { short: 'bctwz', long: ['binary', 'check', 'tag', 'text', 'zero', 'ignore-missing',
    'quiet', 'status', 'strict', 'warn'] },
  shasum: { short: 'abctUw0s', valued: 'a', long: ['algorithm', 'binary', 'check', 'text',
    'tag', 'ignore-missing', 'quiet', 'status', 'strict', 'warn'] },
  du: { short: 'aAbcdgHhIkLlmnPrsx0', valued: 'dBIt',
    long: ['all', 'apparent-size', 'block-size', 'bytes', 'total', 'dereference-args',
      'max-depth', 'human-readable', 'inodes', 'dereference', 'count-links',
      'no-dereference', 'separate-dirs', 'si', 'summarize', 'threshold', 'time', 'time-style',
      'exclude', 'exclude-from', 'one-file-system', 'null'] },
  tree: { short: 'adlfxLPIgpsuhDFvtrcUNQCnASJXiq', valued: 'LPI',
    long: ['noreport', 'dirsfirst', 'charset', 'filelimit', 'prune', 'matchdirs',
      'ignore-case', 'sort', 'du', 'si', 'timefmt', 'inodes', 'device'] },
  sort: { short: 'bdfgiMhnRrVcCksutzmS', valued: 'ktS',
    long: ['ignore-leading-blanks', 'dictionary-order', 'ignore-case',
      'general-numeric-sort', 'ignore-nonprinting', 'month-sort', 'human-numeric-sort',
      'numeric-sort', 'random-sort', 'reverse', 'version-sort', 'check', 'merge', 'key',
      'stable', 'field-separator', 'unique', 'zero-terminated', 'sort', 'parallel',
      'buffer-size', 'debug'] },
  jq: { short: 'rcnesjaSCMR0Lf', valued: 'Lf',
    long: ['raw-output', 'compact-output', 'null-input', 'exit-status', 'slurp',
      'join-output', 'ascii-output', 'sort-keys', 'color-output', 'monochrome-output', 'tab',
      'indent', 'arg', 'argjson', 'slurpfile', 'rawfile', 'args', 'jsonargs', 'from-file',
      'seq', 'stream', 'stream-errors', 'raw-input', 'raw-output0', 'unbuffered'] },
  cd: { short: 'LPe@' },
  pushd: { short: 'LPe@' },
  popd: { short: '' },
  exit: { short: '*' },
  export: { short: 'fnp' },
  set: { short: '*' },
  unset: { short: 'fvn' },
  wait: { short: 'nfp' },
  find: {},
}));
// The primaries of find that read only, and those of them that take a value. -exec,
// -execdir, -ok and -okdir run a command, which opaque reads on its own.
const FIND_PRIMARIES = new Set(['name', 'iname', 'path', 'ipath', 'wholename', 'iwholename',
  'regex', 'iregex', 'regextype', 'type', 'xtype', 'size', 'mtime', 'mmin', 'atime', 'amin',
  'ctime', 'cmin', 'newer', 'newermt', 'anewer', 'cnewer', 'empty', 'perm', 'user', 'group',
  'uid', 'gid', 'maxdepth', 'mindepth', 'depth', 'prune', 'print', 'print0', 'printf', 'ls',
  'follow', 'L', 'H', 'P', 'E', 'X', 'x', 's', 'd', 'o', 'or', 'a', 'and', 'not', 'samefile',
  'inum', 'links', 'readable', 'writable', 'executable', 'true', 'false', 'quit', 'mount',
  'xdev', 'nouser', 'nogroup', 'lname', 'ilname', 'noleaf', 'fstype', 'used', 'daystart',
  'D']);
const FIND_VALUED = new Set(['name', 'iname', 'path', 'ipath', 'wholename', 'iwholename',
  'regex', 'iregex', 'regextype', 'type', 'xtype', 'size', 'mtime', 'mmin', 'atime', 'amin',
  'ctime', 'cmin', 'newer', 'newermt', 'anewer', 'cnewer', 'perm', 'user', 'group', 'uid',
  'gid', 'maxdepth', 'mindepth', 'samefile', 'inum', 'links', 'lname', 'ilname', 'printf',
  'fstype', 'used', 'D']);
// The words before a command that run it on a condition, and the words of a loop, a case or
// the end of a group, which run no command.
const CONDITIONS = new Set(['if', 'elif', 'while', 'until', '!']);
const SHAPES = new Set(['for', 'select', 'case', 'in', 'fi', 'done', 'esac', 'then', 'do',
  'else', '{', '}']);
// A word of a shell text that can name a path, also inside quotes or code, as in
// node -e "fs.rmSync('checks/a.ts')": the text between spaces, quotes, parentheses, commas, =,
// ;, <, >, | and &.
const TOKEN = /[^\s'"`(),;=<>|&]+/g;
// The most comparisons of a path, a pattern or a word with a file that the guard makes in
// one call, and the most time it spends, in ms: the runtime runs a call whose hook passes its
// timeout of 120 s, and the guard ends well before that.
const WORK_LIMIT = 200000;
const TIME_LIMIT = 20000;
const TOO_MUCH = 'Split this command into smaller calls: the guard stopped before it read ' +
  `the whole call.\nThe guard does at most ${WORK_LIMIT} units of work in one call and stops ` +
  `after ${TIME_LIMIT / 1000} s, so it cannot tell what this call writes.`;
const OPAQUE = 'Run the checks with no file path or `checks.cjs run locked`; read a locked file ' +
  'with `cat <file>`.\n';
const LOST = 'Write with a path that starts with /: the guard cannot tell the folder that ' +
  'this command runs in.\nA cd after builtin, eval, source or ., with CDPATH, in an if, a ' +
  'loop or a function, or to a folder that a variable names makes the folder unknown. ';
const LINK_MADE = 'Copy, move or link in one call, and write below the result in a later ' +
  'call.\nThe guard reads links on the disk, and an entry that an earlier command of this ' +
  'call makes or moves can be a link that does not exist yet. ';
const UNSURE = 'Write the path without a .. after a folder that does not exist yet: the ' +
  'guard cannot tell\nwhere such a .. leads, as a later command can make that folder a link. ';
const NOT_JSON = 'Report this error in your output: the tool guard got hook input that is ' +
  'not JSON.\nIn a run, the guard denies a call whose input it cannot read.';

// The commands that write the files they name.
const WRITERS = new Set(['tee', 'cp', 'mv', 'rm', 'rmdir', 'unlink', 'touch', 'ln', 'install',
  'truncate', 'dd', 'chmod', 'chown', 'chgrp', 'chflags', 'mkdir', 'rsync', 'patch']);
// The commands that change the mode, owner or flags of the files they name.
const MODES = new Set(['chmod', 'chown', 'chgrp', 'chflags']);
// The subcommands that make a command write the files it names, as in `<tool> rm <path>` or
// `<tool> -C <folder> restore <path>` of a version control tool.
const SUB_WRITERS = new Set(['rm', 'mv', 'restore', 'checkout']);
// The commands that remove or move the files and folders they name: removing or moving a
// folder above a locked file changes that file.
const REMOVERS = new Set(['rm', 'rmdir', 'unlink', 'mv']);
// The words that run the command after them, with the options of each that take a value,
// as in `env -u X <command>` or `timeout -s KILL 5 <command>`.
const PREFIXES = { env: ['-u', '--unset', '-C', '--chdir', '-S', '--split-string'],
  command: [], exec: ['-a'], nice: ['-n', '--adjustment'],
  timeout: ['-s', '--signal', '-k', '--kill-after'],
  sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'],
  sudoedit: ['-u', '-g', '-C', '-D', '-h', '-p', '-r', '-t', '-U', '-T'], nohup: [],
  time: ['-f', '--format', '-o', '--output'], stdbuf: ['-i', '-o', '-e'],
  xargs: ['-I', '-L', '-n', '-P', '-s', '-d', '-E', '-a', '--arg-file', '--delimiter',
    '--max-args', '--max-procs', '--max-chars', '--max-lines', '--replace', '--eof'],
  doas: ['-u', '-C'], ionice: ['-c', '-n', '-p', '-P', '-u', '--class', '--classdata'],
  busybox: [] };
// The commands that change only folders or the mode of files, which the step count reads
// as no write.
const FOLDER_ONLY = new Set(['mkdir', 'rmdir', 'chmod', 'chown', 'chgrp', 'chflags']);
// The commands that write only their last path, as cp writes the copy and reads the rest.
const LAST_WRITTEN = new Set(['cp', 'install', 'ln', 'rsync']);
// A command that runs another command with words from its input, as in `ls | xargs rm`.
const FED = /(^|[\s/])(xargs|parallel)(?=\s|$)/;
// readsOnlyCall reports whether each simple command of command, from cwd, is a command of
// READ_ONLY with only the options of its list, and writes no file, as in `ls .reports` or
// `tail .reports/runs/<n>.log`, so that the call reads and writes nothing.
function readsOnlyCall(command, cwd) {
  return segments(command, cwd).every((one) => !one.words.length ||
    (READ_ONLY.has(path.basename(plainWords(one.words)[0] || '')) && !segmentWrites(one) &&
      !opaque(one) && !FED.test(one.text)));
}

// shellArgs reports whether segment runs a shell with a -c text and words after the text, its
// $0, $1 and on, as in sh -c ': > "$1"' _ <path>: the text can write each of them, and the
// guard does not read which, so such a shell is opaque.
function shellArgs(segment) {
  if (!SHELL_NAMES.test(path.basename(plainWords(segment.words)[0] || ''))) return false;
  // matchAll reads a copy of SHELL_C, so the lastIndex of SHELL_C stays 0 for other reads.
  const [match] = segment.text.matchAll(SHELL_C);
  return match !== undefined && segment.text.slice(match.index + match[0].length).trim() !== '';
}

// The commands that make or move entries at a destination, any of which can be a link: a
// path through it leads where the guard does not read. An opaque command counts too; mkdir
// and touch make no link.
const MAKERS = new Set(['cp', 'mv', 'rsync', 'ln', 'link', 'mklink', 'install', 'tar', 'unzip']);
// The words that open a group, or the then, do or else part, before a command, as in
// `{ cp a b; }`.
const GROUPS = new Set(['{', '}', 'then', 'do', 'else', '!']);
// A redirect that writes a file: > or >>, also after & or a digit, but no >& to a stream.
const REDIRECT = /(?:^|[^>])>>?(?![>&])/;
// A sed or perl that edits its files in place.
const IN_PLACE = /^(?:sed|perl)$/;

// inPlace reports whether tool, with the words of its command, edits its files in place: sed
// or perl with -i, as in -i, -i.bak or -pi, or sed with --in-place or --in-place=<suffix>.
const inPlace = (tool, words) => IN_PLACE.test(tool) && plainWords(words).some((word) =>
  /^-[A-Za-z]*i/.test(word) || (tool === 'sed' && /^--in-place(?:=|$)/.test(word)));

// The one header of a patch that reviewDeny accepts: a path with no white space at either end,
// as Codex trims it, after one space.
const PATCH_ADD = new RegExp(`^\\*\\*\\* Add File: ([^${PATCH_SPACE}](?:[^]*[^${PATCH_SPACE}])?)$`);

// reportPatch returns the path that patch adds, when patch has the form of this comment, else
// null. The form is a patch of the tool apply_patch, split at line feeds, with no carriage
// return and no NUL: the line `*** Begin Patch`, the line `*** Add File: <path>`, lines that each
// start with +, and the line `*** End Patch`, with at most one line feed after it. Each line is
// compared as it is, with no white space trimmed. <path> is absolute, has no . or .. part, no
// empty part and no trailing slash, and has at most PATH_MAX characters. A second header, an
// update, a delete, a move and any other line make it null.
// Codex writes an Add File over a file that exists, so a second Add File rewrites a report:
// apply_hunks_to_files in codex-rs/apply-patch/src/lib.rs:473-499 of openai/codex at d3ca5182.
function reportPatch(patch) {
  if (typeof patch !== 'string' || patch.includes('\r') || patch.includes('\0')) return null;
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.length < 3 || lines[0] !== PATCH || lines.at(-1) !== '*** End Patch') return null;
  const add = PATCH_ADD.exec(lines[1]);
  if (!add || !lines.slice(2, -1).every((line) => line.startsWith('+'))) return null;
  const file = add[1];
  return file.length <= PATH_MAX && path.isAbsolute(file) && path.normalize(file) === file &&
    !file.endsWith(path.sep) ? file : null;
}

// patchPaths returns the paths that a Codex patch adds, changes, deletes or moves to, from
// each line that Codex can read as a header. Codex splits the patch at line feeds.
function patchPaths(patch) {
  return String(patch).split('\n').map(patchPath).filter((one) => one !== '');
}

// patchPath returns the path in a line of a Codex patch that adds, changes, deletes or moves
// to a file, or '' for any other line or an empty path. It scans the line once: the regular
// expression that it replaced took time in the square of a run of white space.
function patchPath(line) {
  let start = 0;
  while (start < line.length && PATCH_SPACE_CHAR.test(line[start])) start++;
  const header = PATCH_HEADERS.find((one) => line.startsWith(one, start));
  if (header === undefined) return '';
  let end = line.length;
  while (end > start && PATCH_SPACE_CHAR.test(line[end - 1])) end--;
  const from = start + header.length;
  return from < end ? line.slice(from, end) : '';
}

// kindOf returns { kind, paths } of a call: kind is 'write', 'shell', 'agent' or null.
function kindOf(name, input) {
  const args = input !== null && typeof input === 'object' ? input : {};
  if (Object.hasOwn(WRITE_TOOLS, name)) {
    return { kind: 'write', paths: WRITE_TOOLS[name].map((key) => args[key])
      .filter((one) => typeof one === 'string' && one !== '') };
  }
  if (name === 'apply_patch') return { kind: 'write', paths: patchPaths(args.command || '') };
  if (name === 'Bash') {
    // Codex runs `apply_patch <<'EOF' ...` through its shell tool, as Bash in the input.
    const command = String(args.command || '');
    return { kind: 'shell', command, paths: command.includes(PATCH) ? patchPaths(command) : [] };
  }
  if (AGENT_TOOLS.has(name)) {
    const background = args.run_in_background === true || args.run_in_background === 'true';
    return { kind: 'agent', reason: background ? BACKGROUND : null };
  }
  return { kind: null };
}

// The longest path that the system opens: a longer one fails with ENAMETOOLONG.
const PATH_MAX = 4096;

// The most links that walkPath reads in one path; the system stops with ELOOP after 40.
const LINKS = 40;

// Spent is the error that a budget throws when a call needs more work than the guard does.
class Spent extends Error {}

// budget returns spend(units, clock), which counts units of work of one call and throws Spent
// past WORK_LIMIT units or past deadline, a time in ms. It reads the clock when clock is true,
// as before each read of the disk, and after each 64 units.
function budget(deadline = Date.now() + TIME_LIMIT) {
  let left = WORK_LIMIT;
  let since = 0;
  return (units = 1, clock = false) => {
    left -= units;
    since += units;
    if (left < 0) throw new Spent();
    if (clock || since >= 64) {
      since = 0;
      if (Date.now() > deadline) throw new Spent();
    }
  };
}

// The spend of the budget of the call that the guard reads, or null outside one.
let meter = null;

// metered returns fn(), with spend as the meter while fn runs.
function metered(spend, fn) {
  const before = meter;
  meter = spend;
  try {
    return fn();
  } finally {
    meter = before;
  }
}

// charge spends units from the meter, when there is one.
const charge = (units = 1, clock = false) => {
  if (meter) meter(units, clock);
};

// disk reads the disk as fs does. Before each read it reads the clock and charges the meter a
// unit, and one more for each 64 characters of the path, as the system reads a path part by
// part.
// A read that fails returns the fallback: for a part below a file, a folder that cannot be
// read, a name too long or a NUL. Only Spent leaves a read of disk.
function read(full, fn, fallback) {
  charge(1 + (String(full).length >> 6), true);
  try {
    return fn();
  } catch {
    return fallback;
  }
}
const disk = {
  lstat: (full) => read(full, () => fs.lstatSync(full, { throwIfNoEntry: false }), undefined),
  stat: (full) => read(full, () => fs.statSync(full, { throwIfNoEntry: false }), undefined),
  readlink: (full) => read(full, () => fs.readlinkSync(full), null),
  realpath: (full) => read(full, () => fs.realpathSync.native(full), null),
  exists: (full) => read(full, () => fs.existsSync(full), false),
  readdir: (full) => read(full, () => fs.readdirSync(full, { withFileTypes: true }), []),
};

// walkPath reads full, an absolute path that may contain . and .. parts, as the system does,
// and returns { real, unsure }. It reads the parts from the top once: it reads a link
// through to its target and applies a .. to the real path of the folder before it, so
// l/../x is x in the folder above the target of l. From the first part that does not exist,
// it adds the rest as text, with .. parts resolved as text, and a .. there makes unsure true,
// as the system reads it only after a later command makes that part. real is in the case of
// the names on the disk, so that /tmp/x and /private/tmp/x are one path on macOS, and so are
// Checks/a.ts and checks/a.ts on a disk that ignores case. A path longer than PATH_MAX names
// no file, and walkPath returns it resolved as text.
function walkPath(full) {
  if (full.length > PATH_MAX) return { real: path.resolve(full), unsure: false };
  const { root } = path.parse(full);
  // The parts still to read, the next one last.
  const todo = full.slice(root.length).split(path.sep).filter(Boolean).reverse();
  let at = root;
  let links = 0;
  while (todo.length) {
    const part = todo.pop();
    if (part === '.') continue;
    if (part === '..') {
      at = path.dirname(at);
      continue;
    }
    const next = path.join(at, part);
    // A part that cannot be read is no file, and a link that cannot be read is read as a
    // part that does not exist.
    const stat = disk.lstat(next);
    const target = stat && stat.isSymbolicLink() && links < LINKS ? disk.readlink(next) : null;
    if (!stat || (stat.isSymbolicLink() && target === null)) {
      todo.push(part);
      break;
    }
    if (target === null) {
      at = next;
      continue;
    }
    links += 1;
    if (path.isAbsolute(target)) at = path.parse(target).root;
    const parts = target.split(path.sep).filter(Boolean);
    for (let one = parts.length - 1; one >= 0; one -= 1) todo.push(parts[one]);
  }
  // A folder that exists and cannot be read through holds no link, so the path as it is serves.
  const base = disk.realpath(at) || at;
  const rest = todo.reverse();
  return { real: rest.length ? path.resolve(base, rest.join(path.sep)) : base,
    unsure: rest.includes('..') };
}

// real returns the path that full names, as walkPath reads it.
const real = (full) => walkPath(full).real;

// joined returns word, a path of a command, from the folder from, with its . and .. parts kept
// for walkPath, which applies them after the links before them.
const joined = (from, word) => (path.isAbsolute(word) ? word : `${from}${path.sep}${word}`);

// under reports whether full is dir or a path below it; dir may end with path.sep, as / does.
const under = (full, dir) => full === dir ||
  full.startsWith(dir.endsWith(path.sep) ? dir : `${dir}${path.sep}`);

// caseless reports whether the disk of dir, a folder that exists, ignores case: dir with its
// case swapped reads as the same folder. There, a part of a path that does not exist yet
// matches a name in any case.
function caseless(dir) {
  const swapped = dir.replace(/[A-Za-z]/g, (one) => (one === one.toLowerCase()
    ? one.toUpperCase() : one.toLowerCase()));
  if (swapped === dir) return false;
  const one = disk.realpath(swapped);
  return one !== null && one === disk.realpath(dir);
}

// lockSetup returns { base, io, lockType, readLock }: the reader of the lock of checks.cjs, and
// the io that it takes, for root, the working folder.
function lockSetup({ root, env, script = process.argv[1], plugin, artifacts }) {
  const home = path.resolve(path.dirname(script), '..');
  const dir = path.join(home, 'modules', 'core', 'skills', 'running-a-workflow');
  const base = require(path.join(dir, 'lib', 'base.cjs'));
  const { loadRegistry } = require(path.join(dir, 'lib', 'registry.cjs'));
  const { pluginFolder } = require(path.join(dir, 'lib', 'plugin.cjs'));
  const { lockType, readLock } = require(path.join(dir, 'verbs', 'lock.cjs')).lockReader;
  const io = { artifacts: artifacts || base.ARTIFACTS, cwd: root, home: env.HOME, env,
    plugin: plugin || pluginFolder(path.join(dir, 'checks.cjs')) };
  let registry = null;
  io.registry = () => {
    if (!registry) registry = loadRegistry(io.plugin);
    return registry;
  };
  return { base, io, lockType, readLock };
}

// lockedFiles returns { what, files, number, checks } of the lock that counts: files are the
// real paths of the files it lists under root, the working folder, number is the version of
// the lock, and checks lists each file as { ...record, file }, with the record that
// `lock.files` of the type of the lock lists for the file, or none. It returns { files: [] } when no type of the registry
// has a lock, or no version of it counts, and { type, problem } when the lock of type cannot be
// read. It reads the lock with checks.cjs's reader: in a run, it pulls the lock.
function lockedFiles(args) {
  const { root } = args;
  const { base, io, lockType, readLock } = lockSetup(args);
  let def;
  try {
    def = lockType(io);
  } catch (error) {
    if (error instanceof base.Missing) return { files: [] };
    throw error;
  }
  try {
    const lock = readLock(io, def, null, 'write');
    if (!lock.version || lock.differs) {
      return lock.differs ? { type: def.type,
        problem: `The stored ${lock.what} differs from index.json.` }
        : { files: [] };
    }
    const listed = lock.files.filter((one) => !one.problem).map((one) => ({
      ...(one.record !== null && typeof one.record === 'object' ? one.record : {}),
      file: real(path.resolve(root, one.folder || '.', one.path)) }));
    return { what: lock.what, files: listed.map((one) => one.file), number: lock.number,
      checks: listed };
  } catch (error) {
    if (error instanceof base.Missing) return { type: def.type, problem: error.message };
    throw error;
  }
}

// lockTypeOf returns the type of the registry that has the lock, or null when there is none or
// the registry cannot be read. The type may have `lock.writable` and `lock.refused`, which the
// guard calls below.
function lockTypeOf(args) {
  try {
    const { io, lockType } = lockSetup(args);
    return lockType(io);
  } catch {
    return null;
  }
}

// liftedLock returns lock without the files that `lock.writable` of the type of the lock returns,
// else lock. `lock.writable` takes the agent's name, the version of the lock and the records of
// its files, and returns the files of the lock that the agent may write. Every
// other file stays locked, also when the type has no `lock.writable`, when it throws, or when
// it returns anything but a list of text. name is the name of the agent of the call, or null
// for the main session.
function liftedLock(lock, { root, name, fold, type }) {
  if (!Array.isArray(lock.files) || !lock.files.length || !Array.isArray(lock.checks) ||
    !Number.isInteger(lock.number) || name === null || !type) return lock;
  const writable = type.lock && type.lock.writable;
  if (typeof writable !== 'function') return lock;
  let free;
  try {
    free = writable({ root, number: lock.number, agent: name, checks: lock.checks, fold,
      resolve: (file) => real(path.resolve(root, file)) });
  } catch {
    return lock;
  }
  if (!Array.isArray(free)) return lock;
  const lifted = new Set(free.filter((one) => typeof one === 'string').map(fold));
  return { ...lock, files: lock.files.filter((file) => !lifted.has(fold(file))) };
}

// refusedShell returns the start of the reason that `lock.refused` of the type of the lock
// returns for a shell command of an agent, else null. It is null when the type has no `lock.refused` or throws.
function refusedShell(type, command) {
  const refused = type && type.lock && type.lock.refused;
  if (typeof refused !== 'function') return null;
  try {
    const start = refused({ command });
    return typeof start === 'string' && start !== '' ? start : null;
  } catch {
    return null;
  }
}

// The names of the shells whose -c text the guard reads.
const SHELL_NAMES = /^(?:sh|bash|zsh|dash)$/;
// The quotes and backslashes that the shell drops from the letters of a command name, as in
// \sh, "s"h, s''h or $'sh'.
const QUOTES = `(?:\\\\|\\$?'|")*`;
// A shell that runs the text after -c, as in `sh -c '<text>'` or `bash -o pipefail -lc
// "<text>"`: group 1 is the quote, and group 2 the text. Each repeat in it has one way to
// match a given text, so the time to match grows in a line with the length of the command:
// the path before the shell stops at ; & | ( ) and spaces, an option is - and letters or
// -o and -O with a value, and the -c option is read ahead once.
const SHELL_C = new RegExp(`(?:^|[;&|\\n(\\s])(?:[^\\s;&|()]*/)?(?:${['sh', 'bash', 'zsh', 'dash']
  .map((name) => [...name].map((char) => `${QUOTES}${char}`).join('')).join('|')})${QUOTES}\\s+` +
  '(?:-[oO]\\s+[^-\\s]\\S*\\s+|-[A-Za-z-]+\\s+)*-(?=[A-Za-z]*c)[A-Za-z]+\\s+' +
  '([\'"])((?:(?!\\1)[^\\\\]|\\\\.)*)\\1', 'g');
// The depth of shells in shells whose text the guard reads.
const SHELL_DEPTH = 2;

// commands returns command and the text that each shell in it runs with -c, down to
// SHELL_DEPTH shells deep, so that the rules read `sh -c 'cp a <path>'` as `cp a <path>`.
function commands(command, depth = 0) {
  const out = [command];
  if (depth >= SHELL_DEPTH) return out;
  for (const match of command.matchAll(SHELL_C)) {
    const text = match[1] === '"' ? match[2].replace(/\\(["\\$`])/g, '$1') : match[2];
    for (const one of commands(text, depth + 1)) out.push(one);
  }
  return out;
}

// shellText returns word as the shell reads it: without its quotes, and with the character
// after each backslash that escapes it, outside single quotes; in $'...', with the escapes
// that ansi reads. With keep, a wildcard, *, ?,
// [ or ], or a backslash that quotes or a backslash made literal keeps a backslash before it,
// so that the result is a pattern for globMatch whose live wildcards are the unquoted ones.
// A ~ at the start of word, alone or before a /, becomes homeDir, as the shell expands it,
// and a ~+ becomes ., the folder that the shell runs the command in, from which the guard
// reads the path; a quoted ~, a ~- and a ~user stay as they are.
function shellText(word, keep) {
  if (/^~\+(?:\/|$)/.test(word)) return `.${shellText(word.slice(2), keep)}`;
  if (homeDir !== null && /^~(?:\/|$)/.test(word)) {
    const home = keep ? homeDir.replace(/[*?[\]\\]/g, '\\$&') : homeDir;
    return `${home}${shellText(word.slice(1), keep)}`;
  }
  if (!/['"\\]/.test(word)) return word;
  const cache = keep ? PATTERNS : PLAIN_TEXTS;
  if (cache.has(word)) return cache.get(word);
  charge(1 + (word.length >> 8));
  if (cache.size >= 4096) cache.clear();
  const out = readShellText(word, keep);
  cache.set(word, out);
  return out;
}

// The answers of shellText by word, with keep and without: the guard reads a word once for
// each file of the lock.
const PATTERNS = new Map();
const PLAIN_TEXTS = new Map();
// The home folder of the call that decide reads, from $HOME when it is an absolute path, or
// null. With null, a ~ at the start of a word stays, and the path of the word is vague.
let homeDir = null;

// setHome sets homeDir from home, the value of $HOME.
function setHome(home) {
  const next = typeof home === 'string' && path.isAbsolute(home) ? path.normalize(home) : null;
  if (next === homeDir) return;
  // The answers of shellText depend on homeDir.
  PATTERNS.clear();
  PLAIN_TEXTS.clear();
  homeDir = next;
}

// readShellText returns the answer of shellText for a word with a quote or a backslash.
function readShellText(word, keep) {
  const one = (char) => (keep && /[*?[\]\\]/.test(char) ? `\\${char}` : char);
  let out = '';
  let quote = null;
  for (let at = 0; at < word.length; at += 1) {
    const char = word[at];
    if (quote === "'") {
      if (char === "'") quote = null;
      else out += one(char);
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && /[$`"\\\n]/.test(word[at + 1] || '')) {
        at += 1;
        out += one(word[at]);
      } else out += one(char);
    } else if (quote === 'ansi') {
      if (char === "'") quote = null;
      else if (char === '\\' && at + 1 < word.length) {
        const [text, used] = ansi(word, at + 1);
        out += [...text].map(one).join('');
        at += used;
      } else out += one(char);
    } else if (char === '$' && word[at + 1] === "'") {
      quote = 'ansi';
      at += 1;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '\\' && at + 1 < word.length) {
      at += 1;
      out += one(word[at]);
    } else out += char;
  }
  return out;
}

// The characters of the escapes of $'...' that stand for one character.
const ANSI = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t',
  v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };

// ansi returns [text, used] of the escape of $'...' in word that starts at at, after its
// backslash: the text it stands for, and the number of characters it takes. It reads \xHH,
// \NNN in octal and the escapes of ANSI; any other keeps its backslash.
function ansi(word, at) {
  const char = word[at];
  const hex = /^x([0-9A-Fa-f]{1,2})/.exec(word.slice(at, at + 3));
  if (hex) return [String.fromCharCode(parseInt(hex[1], 16)), hex[0].length];
  const octal = /^[0-7]{1,3}/.exec(word.slice(at, at + 3));
  if (octal) return [String.fromCharCode(parseInt(octal[0], 8)), octal[0].length];
  if (Object.hasOwn(ANSI, char)) return [ANSI[char], 1];
  return [`\\${char}`, 1];
}

// unquote returns word as the shell reads it, without quotes and escapes.
const unquote = (word) => shellText(word, false);

// plainWords returns words as the shell reads them, with unquote, once for each array of words.
function plainWords(words) {
  if (!PLAIN_WORDS.has(words)) {
    charge(1 + (words.length >> 6));
    PLAIN_WORDS.set(words, words.map(unquote));
  }
  return PLAIN_WORDS.get(words);
}
const PLAIN_WORDS = new WeakMap();

// patternOf returns word as a pattern of globMatch: its quoted wildcards escaped.
const patternOf = (word) => shellText(word, true);

// The most words that braces makes of one word.
const BRACED = 64;

// braceGroups returns the top-level brace groups of word that the shell expands, each as
// { start, end, parts, nested }: a { outside quotes, not after $ or a backslash, whose }
// closes it with a comma at its level between them, or with a sequence of sequence between
// them. parts are the texts between those commas, or the words of the sequence, and nested
// reports whether a group holds another group. One pass with a stack of open
// braces finds them, so the time grows in a line with the length of word.
function braceGroups(word) {
  const groups = [];
  const open = [];
  let quote = null;
  for (let at = 0; at < word.length; at += 1) {
    const char = word[at];
    if (quote) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"') at += 1;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '\\') at += 1;
    else if (char === '{' && word[at - 1] !== '$') {
      open.push({ start: at, commas: [], nested: false });
    } else if (char === ',' && open.length) open[open.length - 1].commas.push(at);
    else if (char === '}' && open.length) {
      const group = open.pop();
      const range = group.commas.length ? null : sequence(word.slice(group.start + 1, at));
      if ((group.commas.length || range) && open.length) open[open.length - 1].nested = true;
      if (group.commas.length && !open.length) {
        const cuts = [group.start, ...group.commas, at];
        groups.push({ start: group.start, end: at, nested: group.nested,
          parts: cuts.slice(1).map((cut, k) => word.slice(cuts[k] + 1, cut)) });
      } else if (range && !open.length) {
        groups.push({ start: group.start, end: at, nested: false, parts: range });
      }
    }
  }
  return groups;
}

// sequence returns the words of body, the text in the braces of a sequence such as {1..5},
// {01..10..3} or {a..e}, as the shell makes them, up to BRACED + 1 words, or null when body
// is no sequence. A number with a leading 0 pads every number to the widest of the two.
function sequence(body) {
  const numbers = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body);
  const letters = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(body);
  const match = numbers || letters;
  if (!match) return null;
  const [from, to] = numbers ? [Number(match[1]), Number(match[2])]
    : [match[1].charCodeAt(0), match[2].charCodeAt(0)];
  const step = Math.abs(Number(match[3] || 1)) || 1;
  const pad = numbers && [match[1], match[2]].some((one) => /^-?0\d/.test(one))
    ? Math.max(match[1].length, match[2].length) : 0;
  const out = [];
  for (let at = from; (from <= to ? at <= to : at >= to) && out.length <= BRACED;
    at += from <= to ? step : -step) {
    if (letters) out.push(String.fromCharCode(at));
    else if (at < 0) out.push(`-${String(-at).padStart(pad - 1, '0')}`);
    else out.push(String(at).padStart(pad, '0'));
  }
  return out;
}

// braces returns the words of word after the shell expands its braces, as in `rm {a,b}`, up to
// BRACED words. When word would have more, or has a group in a group, it also returns word
// with each group as *, so that the guard reads every path that the shell could make. A brace
// with no comma and no sequence, such as {} or ${x}, stays.
function braces(word) {
  const groups = braceGroups(word);
  if (!groups.length) return [word];
  let out = [''];
  let over = groups.some((group) => group.nested);
  let from = 0;
  for (const group of groups) {
    const before = word.slice(from, group.start);
    const next = [];
    for (const head of out) {
      for (const part of group.parts) {
        if (next.length >= BRACED) {
          over = true;
          break;
        }
        next.push(`${head}${before}${part}`);
      }
      if (next.length >= BRACED) {
        over = over || out.length * group.parts.length > BRACED;
        break;
      }
    }
    out = next;
    from = group.end + 1;
  }
  out = out.map((head) => `${head}${word.slice(from)}`);
  if (!over) return out;
  let star = '';
  from = 0;
  for (const group of groups) {
    star += `${word.slice(from, group.start)}*`;
    from = group.end + 1;
  }
  return [...out, `${star}${word.slice(from)}`];
}

// The short options of time and sudo that take a value, as in `time -f %e -o <file>`; in a
// group of short options, as in `time -ao <file>`, the value is the rest of the group or the
// next word.
const VALUED = { time: 'fo', sudo: 'ugCDhprtUT', sudoedit: 'ugCDhprtUT' };

// prefixOutputs reads the option of a word of PREFIXES at words[at], as in `time -o <file>`
// or `sudo -e <file>`, and returns { skip, files, edit }: skip is the number of words that
// the option and its value take, files the words of the files that time writes with -o,
// --output or --output=, and edit whether sudo edits the files after its options, with -e or
// --edit. It returns null for an option that neither time nor sudo reads this way.
function prefixOutputs(prefix, words, at) {
  const option = unquote(words[at]);
  if (prefix === 'time' && (option === '-o' || option === '--output')) {
    return { skip: 2, files: words[at + 1] === undefined ? [] : [words[at + 1]], edit: false };
  }
  if (prefix === 'time' && option.startsWith('--output=')) {
    return { skip: 1, files: [words[at].slice(words[at].indexOf('=') + 1)], edit: false };
  }
  if (prefix === 'sudo' && option === '--edit') return { skip: 1, files: [], edit: true };
  if (!Object.hasOwn(VALUED, prefix) || !/^-[A-Za-z]+/.test(option)) return null;
  for (let letter = 1; letter < option.length; letter += 1) {
    const char = option[letter];
    if (prefix === 'sudo' && char === 'e') return { skip: 1, files: [], edit: true };
    if (!VALUED[prefix].includes(char)) continue;
    const rest = option.slice(letter + 1);
    const value = rest || words[at + 1];
    const files = char === 'o' && value !== undefined ? [rest || words[at + 1]] : [];
    return { skip: rest ? 1 : 2, files, edit: false };
  }
  return null;
}

// The options of env, sudo and doas that the guard reads: those that set no variable, run no
// shell and pass no command line, as { short, valued, long }, where valued are the short
// options that take a value. Any other option, such as `env -S <text>`, `env -C <folder>`,
// `sudo -E`, `sudo -i`, `sudo -D <folder>` or `doas -s`, can change what the command runs.
const PREFIX_READ = {
  env: { short: 'i0u', valued: 'u', long: ['ignore-environment', 'null', 'unset'] },
  sudo: { short: 'AbBHknNPSugChprtTU', valued: 'ugChprtTU', long: ['user', 'group',
    'non-interactive', 'stdin', 'askpass', 'set-home', 'preserve-groups', 'background', 'bell',
    'close-from', 'host', 'prompt', 'role', 'type', 'command-timeout', 'other-user',
    'reset-timestamp', 'remove-timestamp'] },
  doas: { short: 'nuCL', valued: 'uC', long: [] },
};
PREFIX_READ.sudoedit = PREFIX_READ.sudo;

// prefixReads reports whether option, an option of prefix, is one that PREFIX_READ lists, or
// one of a prefix that PREFIX_READ does not list: -, -- and a group of short options, as in
// -iu X, are too.
function prefixReads(prefix, option) {
  const list = PREFIX_READ[prefix];
  if (!list || option === '-' || option === '--') return true;
  if (option.startsWith('--')) return list.long.includes(option.slice(2).split('=')[0]);
  for (let at = 1; at < option.length; at += 1) {
    if (!list.short.includes(option[at])) return false;
    if (list.valued.includes(option[at])) return true;
  }
  return true;
}

// lastValued reports whether option, a group of short options of a prefix of PREFIX_READ,
// ends in an option that takes the next word as its value, as -iu does in `env -iu X`.
function lastValued(prefix, option) {
  const list = PREFIX_READ[prefix];
  return Boolean(list) && /^-[^-]/.test(option) && list.valued.includes(option.slice(-1)) &&
    ![...option.slice(1, -1)].some((char) => list.valued.includes(char));
}

// commandWords returns { words, dirs, outputs } of a simple command: words are the words from
// the command that runs, without the NAME=value words that set variables, the words of
// GROUPS, and each word of PREFIXES with its options and, for timeout, its time; the first
// word, the name of the command, is read as the shell reads it, as in \cp, "c"p or c''p.
// dirs are the folders that `env -C <folder>` or `env --chdir=<folder>` runs the command in.
// outputs are the words of the files that a prefix writes: `time -o <file>`, and each file
// after the options of `sudo -e` or sudoedit, which edit them. vars reports whether a
// NAME=value word, before the command or after env, sets a variable of the command, and
// blind whether a prefix has an option that prefixReads does not read: such a command is
// opaque, and when no word follows the options, its words are those of the prefix.
function commandWords(words) {
  const dirs = [];
  const outputs = [];
  let edit = false;
  let vars = false;
  let blind = -1;
  let at = 0;
  while (at < words.length) {
    const word = unquote(words[at]);
    if (GROUPS.has(word) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      vars = vars || !GROUPS.has(word);
      at += 1;
      continue;
    }
    const prefix = path.basename(word);
    if (!Object.hasOwn(PREFIXES, prefix)) break;
    if (prefix === 'sudoedit') edit = true;
    const start = at;
    at += 1;
    while (at < words.length && words[at].startsWith('-')) {
      const option = unquote(words[at]);
      if (blind < 0 && !prefixReads(prefix, option)) blind = start;
      if (prefix === 'env' && (option === '-C' || option === '--chdir')) {
        dirs.push(unquote(words[at + 1] || ''));
      }
      if (prefix === 'env' && option.startsWith('--chdir=')) dirs.push(option.slice(8));
      const read = prefixOutputs(prefix, words, at);
      if (read) {
        for (const file of read.files) outputs.push(file);
        edit = edit || read.edit;
        at += read.skip;
      } else at += PREFIXES[prefix].includes(words[at]) || lastValued(prefix, option) ? 2 : 1;
    }
    if (prefix === 'timeout') at += 1;
    if (edit) break;
  }
  const rest = words.slice(blind >= 0 && at >= words.length ? blind : at);
  if (rest.length) rest[0] = unquote(rest[0]);
  return { words: rest, dirs, outputs: edit ? outputs.concat(rest) : outputs,
    vars: vars && rest.length > 0, blind: blind >= 0 };
}

// plainRedirects returns text with each redirect of bash and zsh that writes a file as > or
// >>: >| and >! (zsh), >>| and >>!, &> and &>>, >& and >>& to a word that is not a number, -
// or p, each also with | or ! after it. A >& or >>& to a stream stays.
function plainRedirects(text) {
  return text.replace(/&>(>?)[|!]?/g, ' >$1')
    .replace(/>(>?)&[|!]?(?!\s*(?:\d+|-|p)(?=$|[\s;&|<>()]))/g, '>$1 ')
    .replace(/>(>?)[|!]/g, '>$1');
}

// segments returns the simple commands of a shell command and of the text of each shell in
// it that commands finds: each text split at ; & | ( ) ` and line breaks, but not at the |
// or & of a redirect, which plainRedirects reads, so that a group such as `( cp a b )` or
// `$(cp a b)` reads as its command, each as { text, words, cwds, at, dots, cut }. cut tells
// that the split at a ( or a `, or at the & of a redirect such as 2>&1, can leave out words of
// the command. words are the words that commandWords keeps; cwds the known folders that the
// command can run in, as folders finds them from cwd; at the folder it runs in, as walk finds
// it, or null when that is unknown; and dots whether a wildcard matches a leading dot.
function segments(command, cwd = process.cwd(), keep = () => true) {
  const texts = commands(dropBodies(command)).map((one, index) => {
    // An escaped parenthesis, as in `find . \( -name a \) -delete`, is a word of the command.
    const pieces = plainRedirects(one).replace(/\\[()]/g, ' ').split(/([;&|\n()`]+)/);
    const out = [];
    for (let at = 0; at < pieces.length; at += 2) {
      const after = pieces[at + 1] || '';
      const cut = /^[(`]/.test(after) || (/[<>]\s*$/.test(pieces[at]) &&
        !/^\s*[\d-]+(?:\s+\d*[<>]+\s*[^\s'"\\<>$]+)*\s*$/.test(pieces[at + 2]));
      out.push({ text: pieces[at], before: pieces[at - 1] || '', after, cut, index,
        ...commandWords(pieces[at].trim().split(/\s+/).filter(Boolean).flatMap(braces)) });
    }
    return out;
  });
  const all = texts.flat();
  // After an export, declare -x, typeset -x, set -a or set -k, each later command runs with
  // the variables that the call sets.
  let exported = false;
  for (const one of all) {
    one.vars = one.vars || (exported && one.words.length > 0);
    exported = exported || exports(one.words);
  }
  const changes = all.some((one) => one.words.length &&
    CD.has(path.basename(unquote(one.words[0]))));
  const flags = { cdpath: /\bCDPATH=/.test(command) || Boolean(process.env.CDPATH),
    autocd: optionsIn(command, all, ['autocd']) };
  for (const parts of texts) walk(parts, parts[0].index === 0 || !changes ? cwd : null, flags);
  const parts = all.filter((one) => one.words.length);
  const from = folders(parts, cwd);
  // A wildcard matches a leading dot only after the shell is set to: dotglob in bash,
  // globdots in zsh in any spelling, or GLOBIGNORE, which turns dotglob on.
  const dots = optionsIn(command, all, ['dotglob', 'globdots', 'globignore']);
  return parts.filter(keep).map(({ text, words, dirs, outputs, at, lost, vars, blind, cut }) => {
    const chdirs = [...dirs, ...toolDirs(words)];
    const known = chdirs.filter((dir) => !vague(dir));
    const cwds = from.map((one) => into(one, known));
    const sure = at !== null && known.length === chdirs.length;
    return { text, words, outputs, cwds, lost, vars, blind, cut,
      at: sure ? into(at, known) : null, dots };
  });
}

// exports reports whether words, the words of a simple command, export variables to the
// commands after it, or make later NAME=value words set variables: export, a declare,
// typeset, local or readonly with -x, or a set, setopt, unsetopt, emulate or shell that
// shellOptions finds to name allexport, as set -a does, or keywordargs, as set -k does.
function exports(words) {
  const plain = plainWords(words);
  const name = path.basename(plain[0] || '');
  const options = plain.slice(1).filter((word) => /^[-+]/.test(word));
  if (name === 'export') return true;
  if (['declare', 'typeset', 'local', 'readonly'].includes(name)) {
    return options.some((word) => /^-[A-Za-z]*x/.test(word));
  }
  const named = shellOptions(words);
  return named.has('allexport') || named.has('keywordargs');
}

// The commands that set shell options, besides a shell itself, as in `bash -a -c <text>`.
const OPTION_SETTERS = new Set(['set', 'setopt', 'unsetopt', 'emulate']);
// The letters of the options that the guard reads, in bash or zsh: -a allexport, -k
// keywordargs, -J autocd and -4 globdots.
const OPTION_LETTERS = { a: 'allexport', k: 'keywordargs', J: 'autocd', 4: 'globdots' };

// shellOptions returns the names of the shell options that words, a simple command, turn on
// or off, as zsh reads a name: in lower case, without _ or -, and also without a no before
// it, so that ALL_EXPORT and noallexport are both allexport. It reads each letter of
// OPTION_LETTERS in a -x or +x word, the name after -o or +o, a --name of a shell and, for
// setopt and unsetopt, each word that is no option. set and a shell stop at the first word
// that is no option.
function shellOptions(words) {
  const plain = plainWords(words);
  const name = path.basename(plain[0] || '');
  const out = new Set();
  if (!OPTION_SETTERS.has(name) && !SHELL_NAMES.test(name)) return out;
  const add = (option) => {
    const one = option.toLowerCase().replace(/[_-]/g, '');
    out.add(one);
    if (one.startsWith('no')) out.add(one.slice(2));
  };
  const listed = name === 'setopt' || name === 'unsetopt';
  for (let at = 1; at < plain.length; at += 1) {
    const word = plain[at];
    if (word === '--' && !listed) break;
    if (word.startsWith('--')) add(word.slice(2));
    else if (/^[-+]./.test(word)) {
      for (const letter of word.slice(1)) {
        if (Object.hasOwn(OPTION_LETTERS, letter)) out.add(OPTION_LETTERS[letter]);
        if (letter === 'o') add(plain[(at += 1)] || '');
      }
    } else if (listed) add(word);
    else break;
  }
  return out;
}

// optionsIn reports whether command, a shell command of all, its simple commands, can turn on
// an option of names: a shell option that shellOptions finds, or a name in the text, which
// eval or a script can run, in lower case without _, - and quotes. It charges a unit for each
// KB of the text.
function optionsIn(command, all, names) {
  charge(1 + (command.length >> 10));
  const text = command.toLowerCase().replace(/[_\-'"\\]/g, '');
  return names.some((one) => text.includes(one)) ||
    all.some((one) => [...shellOptions(one.words)].some((option) => names.includes(option)));
}

// into returns the folder that a command runs in from the folder from after a cd to each of
// dirs, in order. It charges each step by the length of the path, which grows with each step.
function into(from, dirs) {
  let at = from;
  for (const dir of dirs) {
    charge(1 + ((at.length + dir.length) >> 8));
    at = path.resolve(at, dir);
  }
  return at;
}

// link returns the kind of a separator between two commands of a shell text, without its
// parentheses and backticks: '&&', '||', '|', '&', ';' for ; and line breaks, or ''.
function link(separator) {
  const plain = separator.replace(/[()`]/g, '');
  if (plain.includes('||')) return '||';
  if (plain.includes('&&')) return '&&';
  if (plain.includes('|')) return '|';
  if (/[;\n]/.test(plain)) return ';';
  return plain.includes('&') ? '&' : '';
}

// The words that open an if, a loop or a case, and the words that close one.
const OPENS = new Set(['if', 'while', 'until', 'for', 'select', 'case']);
const CLOSES = new Set(['fi', 'done', 'esac']);
// The commands after which the folder is unknown: eval and source run text that the guard
// does not read, which can change the folder.
const LOSES = new Set(['eval', 'source', '.']);

// walk sets at on each of parts, the commands of one shell text in order, to the folder that
// the shell runs it in, from start, or to null when that is unknown. A cd, pushd or popd
// changes the folder of the commands after it, and the end of its ( ... ), $( ... ) or
// backtick group sets the folder back. The folder is unknown from a command on whose folder
// after it the guard cannot tell: a cd to a vague folder, a cd in a pipe, a popd with no
// pushd, a cd after builtin, a cd while CDPATH may be set, a cd in an if, a loop, a case or
// a { ... } body, which includes a function, eval, source or ., and a call that may set
// auto_cd, where a folder name runs as a cd. From such a command on, walk also sets lost on
// each part: then even folders cannot list the folders that the part can run in. The folder
// is unknown too, but folders lists it, after a cd to a folder that does not exist or
// cannot be read, after `cd ... ||`, and for a command that a ; or a || joins after a cd
// that ran only on the condition of a && before it. A command after `cd <folder> &&` runs in
// that folder, as it runs only when the cd worked. flags are { cdpath, autocd }: whether
// CDPATH may be set and whether the call may set auto_cd.
function walk(parts, start, flags) {
  const { cdpath, autocd } = flags;
  let at = autocd ? null : start;
  let lost = autocd;
  let maybe = false;
  let depth = 0;
  const saved = [];
  const pushed = [];
  let quoted = false;
  for (const part of parts) {
    for (const char of part.before) {
      if (char === '(' || (char === '`' && !quoted)) saved.push({ at, lost, maybe, depth });
      if ((char === ')' || (char === '`' && quoted)) && saved.length) {
        ({ at, lost, maybe, depth } = saved.pop());
      }
      if (char === '`') quoted = !quoted;
    }
    const kind = link(part.before);
    if (maybe && kind !== '&&' && kind !== '') {
      at = null;
      maybe = false;
    }
    part.at = at;
    part.lost = lost;
    const raw = part.text.trim().split(/\s+/).filter(Boolean).map(unquote);
    const first = raw[0] === '!' ? raw[1] : raw[0];
    if (OPENS.has(first)) depth += 1;
    if (CLOSES.has(first)) depth = Math.max(0, depth - 1);
    for (const word of raw) {
      if (word === '{') depth += 1;
      if (word === '}') depth = Math.max(0, depth - 1);
    }
    const tool = part.words.length ? path.basename(part.words[0]) : '';
    const to = CD.has(tool) && part.words.slice(1).map(unquote).find((word) =>
      !/^-[LPe@]+$/.test(word) && word !== '--');
    // A cd in a pipe: zsh runs the last command of a pipe in the shell.
    const piped = kind === '|' || link(part.after) === '|';
    if (LOSES.has(tool) || (tool === 'builtin' && raw.some((word) => CD.has(word))) ||
      (CD.has(tool) && (piped || depth > 0 || (tool !== 'popd' && (to === undefined ||
      vague(to) || (cdpath && !/^\.{0,2}\//.test(to) && !path.isAbsolute(to))))))) {
      at = null;
      lost = true;
      continue;
    }
    if (!CD.has(tool) || link(part.after) === '&') continue;
    if (link(part.after) === '||') {
      at = null;
      continue;
    }
    if (kind === '&&' || kind === '||') maybe = true;
    if (tool === 'popd') at = pushed.length ? pushed.pop() : null;
    else if (at !== null) {
      if (tool === 'pushd') pushed.push(at);
      const next = path.resolve(at, to);
      // A folder that cannot be read, a name too long or a NUL: the cd fails.
      const stat = disk.stat(next);
      at = stat && stat.isDirectory() ? next : null;
    }
  }
}

// A here-document operator: group 1 is - for <<-, and group 2 the end word as the call has
// it, a run of quoted texts, escaped characters and other characters, as in <<EOF, <<'EOF',
// <<\E\OF or <<"E"'OF'. The shell ends the body at the word after quote removal, and reads
// the body as text when any part of the word is quoted.
const HEREDOC = /<<(-?)[ \t]*((?:'[^'\n]*'|"(?:[^"\\\n]|\\.)*"|\\.|[^\s;&|<>()'"\\])+)/y;
// The commands whose input is text that they copy to a file or to their output, as in
// `cat > a.ts <<'EOF'`, and apply_patch, whose input is a patch whose files patchPaths reads.
const READERS = new Set(['cat', 'tee', 'apply_patch']);
// A function definition, as in `cat() { sh; }`, `cat () { sh; }` or `function cat { sh; }`, in
// any form and with any name, so that a function named cat or tee is never read as cat or tee.
const DEFINES = /(?:^|[^\w$-])function(?![\w-])|\(\s*\)/;
// The commands besides cat and tee that may run in a call whose here-document bodies the guard
// skips: they run no file and read no input, as in `mkdir -p docs && cat > docs/a.md <<'EOF'`.
const PLAIN = new Set(['echo', 'ls', 'mkdir', 'true']);

// dropBodies returns command without the body of each here-document whose end word is quoted,
// such as <<'EOF', and whose command, after PREFIXES, is one of READERS with no pipe after
// it, because the shell reads such a body as text, with no $( ... ) or backticks, and passes
// it to that command as its input. Any other command could run the lines of the body, so its
// body stays. It reads the command once, line by line, and returns it as it is when a body
// has no end, when the command ends in a quote or after a backslash, when heredocs returns
// null, when another command of the lines outside the bodies is not one of PLAIN or a cat or
// tee that reads, because it could run a file that cat or tee writes, or when those lines
// define a function, which can be named cat.
function dropBodies(command) {
  if (!command.includes('<<')) return command;
  const kept = [];
  // The here-documents whose bodies come next, from pending[head] on.
  const pending = [];
  let head = 0;
  const scan = heredocs();
  let dropped = false;
  for (const line of command.split('\n')) {
    if (head < pending.length) {
      const { end, dash, drop } = pending[head];
      if ((dash ? line.replace(/^\t+/, '') : line) === end) head += 1;
      if (drop) dropped = true;
      else kept.push(line);
      continue;
    }
    kept.push(line);
    const found = scan.next(line);
    if (!found) return command;
    for (const one of found) pending.push(one);
  }
  if (head < pending.length || scan.open() || !dropped || scan.other()) return command;
  const rest = kept.join('\n');
  return DEFINES.test(rest) ? command : rest;
}

// plain reports whether text, a simple command, is one of PLAIN after PREFIXES, or has no
// words but variables that it sets, as in `X=1`, and words of GROUPS, such as `}`.
function plain(text) {
  const all = text.trim().split(/\s+/).filter(Boolean);
  const { words } = commandWords(all);
  if (words.length) return PLAIN.has(words[0]);
  return all.every((word) => GROUPS.has(unquote(word)) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
}

// reads reports whether text, a simple command with its here-document operators removed, is
// cat or tee after PREFIXES other than xargs, which would run the command once for each line,
// and after no variable setting, as in `PATH=<folder> cat`, which can make cat another program.
function reads(text) {
  const all = text.trim().split(/\s+/).filter(Boolean);
  const { words } = commandWords(all);
  const before = all.slice(0, all.length - words.length);
  return words.length > 0 && READERS.has(words[0]) && !before.some((word) =>
    path.basename(unquote(word)) === 'xargs' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(unquote(word)));
}

// heredocs returns { next, open, other }. next reads the next line of a command outside the bodies
// of its here-documents and returns { end, dash, drop } of each here-document operator of the
// command line that the line ends, in order: its end word, whether it is <<-, and whether its
// body is text to drop: the end word is quoted and the command of the operator reads. A
// command line goes on to the next line after a backslash at its end or in a quote, as in the
// shell; next then returns no operator, and open returns true. A command ends at ; & | ( ) `
// and the end of the command line, but not at the & or | of a redirect such as 2>&1, &>, >|
// or >&|;
// a command that ends at a pipe, a ( or a backtick sends its input on, so its body stays. next
// skips a << in quotes, after a backslash, or in a comment, which starts with a # at the start
// of a word. next returns null where it cannot know the lines of a body or the quotes: for an
// operator on a command line of more than one line, and for $( or a backtick in double quotes.
// other returns true when a command of the lines read is neither a cat or tee that reads nor
// plain.
function heredocs() {
  let quote = null;
  let text = '';
  let found = [];
  let out = [];
  let lines = 0;
  let open = false;
  let other = false;
  const close = (after) => {
    const reader = !/[|(`]/.test(after) && reads(text);
    if (!reader && !plain(text)) other = true;
    for (const one of found) out.push({ ...one, drop: one.quoted && reader });
    text = '';
    found = [];
  };
  const next = (line) => {
    // In $(( ... )) and (( ... )), << is a shift, which the reader cannot tell from an operator.
    if (line.includes('((')) return null;
    lines += 1;
    let more = false;
    for (let at = 0; at < line.length; at += 1) {
      const char = line[at];
      if (quote === "'") {
        if (char === "'") quote = null;
        text += char;
      } else if (quote) {
        if (char === '\\') {
          more = at + 1 === line.length;
          text += line.slice(at, at + 2);
          at += 1;
          continue;
        }
        if (quote === '"' && (char === '`' || (char === '$' && line[at + 1] === '('))) return null;
        if (char === (quote === '"' ? '"' : "'")) quote = null;
        text += char;
      } else if (char === '\\') {
        more = at + 1 === line.length;
        text += line.slice(at, at + 2);
        at += 1;
      } else if (char === '$' && line[at + 1] === "'") {
        quote = 'ansi';
        text += "$'";
        at += 1;
      } else if (char === "'" || char === '"') {
        quote = char;
        text += char;
      } else if (char === '#' && (at === 0 || /\s/.test(line[at - 1]))) break;
      else if (char === '<' && line[at + 1] === '<' && line[at + 2] !== '<') {
        HEREDOC.lastIndex = at;
        const match = HEREDOC.exec(line);
        if (match) {
          found.push({ end: unquote(match[2]), dash: match[1] === '-',
            quoted: /['"\\]/.test(match[2]) });
          text += ' ';
          at = HEREDOC.lastIndex - 1;
        } else {
          text += '<<';
          at += 1;
        }
      } else if (char === '<' && line[at + 1] === '<') {
        text += '<<<';
        at += 2;
      } else if (/[;)(`]/.test(char) || (char === '|' && line[at - 1] !== '>' &&
        !(line[at - 1] === '&' && line[at - 2] === '>')) ||
        (char === '&' && !/[<>]/.test(line[at - 1] || '') && line[at + 1] !== '>')) close(char);
      else text += char;
    }
    open = Boolean(quote) || more;
    if (open) {
      text += '\n';
      return found.length || out.length ? null : [];
    }
    close('');
    const done = lines > 1 && out.length ? null : out;
    out = [];
    lines = 0;
    return done;
  };
  return { next, open: () => open, other: () => other };
}

// The commands that change the folder of the commands after them.
const CD = new Set(['cd', 'pushd', 'popd']);
// The most folders that folders follows.
const FOLDERS = 16;

// vague reports whether the folder or file of word is unknown before the shell runs: it
// starts with a ~user, a ~-, or a ~ with no homeDir, contains $ or a backtick, is - for the
// folder before, or is empty. A ~+ is the folder of the command.
const vague = (word) => word === '' || word === '-' || /[$`]/.test(word) ||
  (word.startsWith('~') && !/^~\+(?:\/|$)/.test(word) &&
    (homeDir === null || !/^~(?:\/|$)/.test(word)));

// folders returns the known folders that the commands of parts can run in: cwd and each
// folder that a cd or pushd in parts changes to, from each folder before it, since a cd can
// fail, run in a group, or not run at all, up to FOLDERS folders. A cd to a vague folder or
// to the home, and a popd, add no folder.
function folders(parts, cwd) {
  let list = [cwd];
  for (const { words } of parts) {
    const tool = path.basename(unquote(words[0]));
    if (!CD.has(tool)) continue;
    const to = words.slice(1).map(unquote).find((word) => !/^-[LPe@]+$/.test(word) &&
      word !== '--');
    if (tool === 'popd' || to === undefined || vague(to)) continue;
    charge(list.length * (1 + ((list[0].length + to.length) >> 8)));
    const more = [...new Set([...list, ...list.map((one) => path.resolve(one, to))])];
    if (more.length <= FOLDERS) list = more;
  }
  return list;
}

// toolDirs returns the folders that a command with a subcommand of SUB_WRITERS runs in, from
// each -C <folder> before the subcommand, as in `<tool> -C <folder> restore <path>`.
function toolDirs(words) {
  if (!subWrites(words)) return [];
  const plain = plainWords(words);
  const out = [];
  const end = subIndex(plain);
  for (let at = 1; at < end; at += 1) {
    if (plain[at] === '-C') out.push(plain[at + 1] || '');
  }
  return out;
}

// subWrites reports whether words, the words of a simple command, run a subcommand of
// SUB_WRITERS: the first word after the tool and its options, which skip -C <value>,
// -c <value> when the value contains =, and each other word that starts with -. So the
// command in `sh -c 'rm <path>'` is read. A restore with --staged or -S and no --worktree,
// or a start of it such as --work, or -W changes only the index, so it writes no file. A
// command of READ_ONLY has no subcommand: the rm of `echo rm <path>` is a word that echo
// prints.
function subWrites(words) {
  const plain = plainWords(words);
  if (READ_ONLY.has(path.basename(plain[0] || ''))) return false;
  const at = subIndex(plain);
  const sub = plain[at];
  if (!SUB_WRITERS.has(sub)) return false;
  if (sub !== 'restore') return true;
  const rest = plain.slice(at + 1);
  // A version control tool takes a start of a long option, such as --work for --worktree.
  const flag = (long, short) => rest.some((word) => (word.length > 2 && long.startsWith(word)) ||
    new RegExp(`^-[A-Za-z]*${short}`).test(word));
  return !flag('--staged', 'S') || flag('--worktree', 'W');
}

// subIndex returns the index in words of the subcommand: the first word after the tool and
// its options, as subWrites reads them.
function subIndex(words) {
  if (!SUB_INDEX.has(words)) SUB_INDEX.set(words, readSubIndex(words));
  return SUB_INDEX.get(words);
}
const SUB_INDEX = new WeakMap();

// readSubIndex returns the answer of subIndex.
function readSubIndex(words) {
  let at = 1;
  while (at < words.length && words[at].startsWith('-')) {
    const value = words[at] === '-C' || (words[at] === '-c' && (words[at + 1] || '').includes('='));
    at += value ? 2 : 1;
  }
  charge(1 + (at >> 6));
  return at;
}

// writes reports whether a simple command writes a file and contains name: a redirect to
// name, a command of WRITERS or with a subcommand of SUB_WRITERS, or sed -i or perl -i.
// With nocase, name matches in any case.
function writes(segment, name, nocase = false) {
  const { at, target } = namePatterns(name, nocase);
  if (!segment.text.includes(nocase ? '' : path.basename(name)) || !at.test(segment.text)) {
    return false;
  }
  const tool = path.basename(segment.words[0]);
  if (WRITERS.has(tool) || subWrites(segment.words)) return true;
  if (inPlace(tool, segment.words) || findParts(segment.words).writes) return true;
  if ((segment.outputs || []).some((word) => at.test(word))) return true;
  return REDIRECT.test(segment.text) && target.test(segment.text);
}

// The patterns of namePatterns, by name and case.
const NAMED = new Map();

// namePatterns returns { at, target } for name: at matches name as a word of a command, and
// target as the target of a redirect. With nocase, they match in any case. They are made once
// for each name.
function namePatterns(name, nocase) {
  const key = `${nocase ? 'i' : ''}:${name}`;
  if (!NAMED.has(key)) {
    const flags = nocase ? 'i' : '';
    const text = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    NAMED.set(key, { at: new RegExp(`(^|[\\s'"=(:>])(\\./)?${text}(?=$|[\\s'")<>;|&/])`, flags),
      target: new RegExp(`>>?\\s*['"]?(\\./)?${text}`, flags) });
  }
  return NAMED.get(key);
}

// A redirect target that is no file.
const NO_FILE = /^['"]?\/dev\/(?:null|stdout|stderr|tty)['"]?$/;

// segmentWrites reports whether a simple command writes a file, whichever file: it runs a
// command of WRITERS or with a subcommand of SUB_WRITERS, sed -i or perl -i,
// `qory artifact push`, or has a redirect to a file.
function segmentWrites(segment) {
  const [first, second, third] = plainWords(segment.words);
  const tool = path.basename(first);
  if (WRITERS.has(tool) || subWrites(segment.words)) return true;
  if (inPlace(tool, segment.words) || findParts(segment.words).writes) return true;
  if (tool === 'qory' && second === 'artifact' && third === 'push') return true;
  return redirectTargets(segment).length > 0;
}

// redirectTargets returns the files that the redirects of a simple command write, and the
// files that a prefix of it writes, as in `time -o <file>`.
function redirectTargets(segment) {
  const outputs = (segment.outputs || []).filter((word) => !NO_FILE.test(word));
  if (!REDIRECT.test(segment.text)) return outputs.map(patternOf);
  // The quoted text of a shell's -c is a command of that shell, as in sh -c 'echo x > a', so
  // its redirects count with or without quotes.
  const plain = plainWords(segment.words);
  const shell = SHELL_NAMES.test(path.basename(plain[0] || '')) &&
    plain.some((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
  const words = shell ? [...segment.text.matchAll(/(?:^|[^>0-9&])&?[0-9]?>>?(?![>&])\s*(\S*)/g)]
    .map((match) => match[1]) : redirectWords(segment.text);
  return words.filter((target) => target !== '' && !NO_FILE.test(target)).concat(outputs)
    .map(patternOf);
}

// redirectWords returns the word after each redirect of text that writes a file: >, >>, and
// either after & or a digit, outside quotes and before a # that starts a comment, as the shell
// reads them. A >& to a stream writes no file. The word ends at white space outside quotes.
function redirectWords(text) {
  const out = [];
  let quote = null;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    if (quote === "'") {
      if (char === "'") quote = null;
    } else if (quote === '"') {
      if (char === '\\') at += 1;
      else if (char === '"') quote = null;
    } else if (char === '\\') at += 1;
    else if (char === "'" || char === '"') quote = char;
    else if (char === '#' && (at === 0 || /\s/.test(text[at - 1]))) break;
    else if (char === '>' && text[at - 1] !== '>') {
      let end = text[at + 1] === '>' ? at + 2 : at + 1;
      if (text[end] === '&' || text[end] === '>') continue;
      while (end < text.length && /\s/.test(text[end])) end += 1;
      const begin = end;
      let inner = null;
      for (; end < text.length; end += 1) {
        const one = text[end];
        if (inner === "'") {
          if (one === "'") inner = null;
        } else if (one === '\\') end += 1;
        else if (inner === '"') {
          if (one === '"') inner = null;
        } else if (one === "'" || one === '"') inner = one;
        else if (/\s/.test(one)) break;
      }
      out.push(text.slice(begin, end));
      at = end - 1;
    }
  }
  return out;
}

// pathWords returns the words of a simple command that can be paths that it writes: the
// targets of its redirects and, for a command of WRITERS, a subcommand of SUB_WRITERS or
// sed -i or perl -i, the words after the tool and its subcommand, and the value of an
// option or of a word with =, as in dd of=<path>. It leaves out the script of sed and perl.
// Each word is a pattern of patternOf, with its quoted wildcards escaped.
function pathWords(segment) {
  if (!worded.has(segment)) worded.set(segment, readPathWords(segment));
  return worded.get(segment);
}

// The answers of pathWords by segment.
const worded = new WeakMap();

// readPathWords returns the answer of pathWords.
function readPathWords(segment) {
  charge(1 + (segment.words.length >> 6));
  const words = plainWords(segment.words);
  const tool = path.basename(words[0]);
  const sub = subWrites(segment.words) ? subIndex(words) : -1;
  const out = redirectTargets(segment);
  if (!WRITERS.has(tool) && sub < 0 && !inPlace(tool, words)) return out;
  let script = tool === 'sed' && !words.some((word) => /^(?:-e|--expression|-f|--file)/.test(word));
  // The words before a subcommand are the tool's options, as in `<tool> -C <folder> rm`.
  for (let at = sub > 0 ? sub + 1 : 1; at < words.length; at += 1) {
    const word = words[at];
    if (IN_PLACE.test(tool) && (word === '-e' || word === '-f' || word === '--expression' ||
      (tool === 'perl' && /^-[A-Za-z]*e$/.test(word)))) {
      at += 1;
      continue;
    }
    const shown = patternOf(segment.words[at]);
    if (word.startsWith('-') || /^[A-Za-z_]+=/.test(word)) {
      if (shown.indexOf('=') > 0) out.push(shown.slice(shown.indexOf('=') + 1));
      continue;
    }
    if (script) {
      script = false;
      continue;
    }
    out.push(shown);
  }
  return out;
}

// findParts returns { starts, names, exec, writes } of a find command of words: the paths it
// starts from, . when none; the patterns of its -name and -iname options, each as
// { pattern, nocase }; the words of each command that its -exec, -execdir, -ok or -okdir
// runs and that writes or is a shell; and whether it writes: with -delete, or an exec of a
// command that writes or of a shell. It returns writes false for any other command.
function findParts(words) {
  const out = { starts: [], names: [], exec: [], writes: false };
  if (path.basename(unquote(words[0] || '')) !== 'find') return out;
  if (found.has(words)) return found.get(words);
  charge(1 + (words.length >> 6));
  found.set(words, out);
  const plain = plainWords(words);
  let at = 1;
  while (at < plain.length && /^-(?:[HLP]|O\d*|D)$/.test(plain[at])) {
    at += plain[at] === '-D' ? 2 : 1;
  }
  while (at < plain.length && !plain[at].startsWith('-') && plain[at] !== '!') {
    out.starts.push(plain[at]);
    at += 1;
  }
  if (!out.starts.length) out.starts.push('.');
  for (; at < plain.length; at += 1) {
    const word = plain[at];
    if ((word === '-name' || word === '-iname') && at + 1 < plain.length) {
      out.names.push({ pattern: plain[at + 1], nocase: word === '-iname' });
      at += 1;
    } else if (word === '-delete') out.writes = true;
    else if (/^-(?:exec|execdir|ok|okdir)$/.test(word)) {
      let end = at + 1;
      while (end < plain.length && plain[end] !== ';' && plain[end] !== '+') end += 1;
      if (end === plain.length) end = -1;
      const exec = plain.slice(at + 1, end < 0 ? plain.length : end)
        .filter((one) => one !== '{}');
      const tool = path.basename(exec[0] || '');
      // A shell that an -exec runs gets each path as $0 or $1 and on, which it can write.
      if (WRITERS.has(tool) || subWrites(exec) || inPlace(tool, exec) || SHELL_NAMES.test(tool)) {
        out.writes = true;
        out.exec.push(exec);
      }
      at = end < 0 ? plain.length : end;
    }
  }
  return out;
}

// The answers of findParts by the words that it read, as the guard reads one command once for
// each file of the lock.
const found = new WeakMap();

// shown returns the names that a -name option of find can match for full: its name and, for a
// folder, the name of each entry below it, up to 1000, read folder by folder from the top.
// It reads each folder once in a call, as listed keeps the names by folder.
function shown(full, folder, listed) {
  if (!folder) return [path.basename(full)];
  if (listed.has(full)) return listed.get(full);
  const out = [path.basename(full)];
  const todo = [full];
  for (let at = 0; at < todo.length && out.length <= 1000; at += 1) {
    // A folder that cannot be read has only its name.
    for (const entry of disk.readdir(todo[at])) {
      if (out.length > 1000) break;
      charge();
      out.push(entry.name);
      if (entry.isDirectory()) todo.push(path.join(todo[at], entry.name));
    }
  }
  listed.set(full, out);
  return out;
}

// madeAt returns the destinations at which segment, a simple command, makes or moves
// entries, each as written, or null when the guard cannot tell them:
// - cp that cpKeepsLinks finds, mv, rsync, ln, link and install: the folder of -t, else the
//   last path; for ln or link with one path, the name of that path; another cp makes none;
// - tar that extracts: the folder of -C or --directory, else .; a tar that creates makes
//   only its archive, a file that is no link;
// - unzip: the folder of -d, else .;
// - an opaque command: each word of its text after the first, as reaches reads the text.
// mklink, a lost folder, and a vague destination or one with a wildcard are unknown.
function madeAt(segment) {
  const words = plainWords(segment.words);
  const tool = path.basename(words[0] || '');
  if (!MAKERS.has(tool) && !opaque(segment)) return [];
  if (tool === 'mklink' || segment.lost) return null;
  let made;
  if (!MAKERS.has(tool)) {
    made = (segment.text.match(TOKEN) || []).slice(1).filter((word) => !word.startsWith('-'));
  } else if (tool === 'tar') {
    // The mode is in an option, as in -xzf, or in the first word, as in tar xzf.
    const extracts = words.some((word) => /^--(?:extract|get)$/.test(word) ||
      /^-[A-Za-z]*x/.test(word)) || /^[A-Za-z]*x/.test(words[1] || '');
    if (!extracts && vague(segment.words[1] || '')) return null;
    if (!extracts) return [];
    const at = words.findIndex((word) => word === '-C' || word === '--directory');
    const dir = words.find((word) => word.startsWith('--directory='));
    made = [at > 0 ? segment.words[at + 1] : dir ? dir.slice(12) : '.'];
  } else if (tool === 'unzip') {
    const at = words.indexOf('-d');
    const dir = words.find((word) => /^-d./.test(word));
    made = [at > 0 ? segment.words[at + 1] : dir ? dir.slice(2) : '.'];
  } else if (tool === 'cp' && !cpKeepsLinks(words)) {
    return [];
  } else {
    const { dest, sources } = copyParts(segment.words);
    made = [sources.length || !['ln', 'link'].includes(tool) ? dest : path.basename(dest || '')];
  }
  if (made.some((one) => one === undefined || vague(one) || wild(one))) return null;
  return made.map((one) => literal(patternOf(one)));
}

// The short options of GNU and macOS cp after which cp still follows each link and writes a
// regular file, and those of them that take a value, as in -S .bak or -t <folder>.
const CP_PLAIN = 'bcfinpuvxLNSTXZt';
const CP_VALUED = 'St';
// The long options of GNU cp after which cp still follows each link; --preserve keeps links
// only with links or all in its list.
const CP_PLAIN_LONG = new Set(['attributes-only', 'backup', 'copy-contents', 'debug',
  'dereference', 'force', 'interactive', 'keep-directory-symlink', 'no-clobber',
  'no-preserve', 'no-target-directory', 'one-file-system', 'parents', 'preserve', 'reflink',
  'remove-destination', 'sparse', 'strip-trailing-slashes', 'suffix', 'target-directory',
  'update', 'verbose', 'context', 'help', 'version']);

// cpKeepsLinks reports whether cp with words can copy a link as a link, or make one: an
// option of -a, -R, -r, -P, -d, -l, -s or -H, their long forms, --preserve with links or
// all, or an option outside CP_PLAIN and CP_PLAIN_LONG, which the guard cannot read. Without
// one, cp follows each link and writes regular files, so its destination makes no link.
function cpKeepsLinks(words) {
  for (let at = 1; at < words.length; at += 1) {
    const word = words[at];
    if (word === '--') return false;
    if (!word.startsWith('-') || word === '-') continue;
    if (word.startsWith('--')) {
      const [name, value = ''] = word.slice(2).split(/=(.*)/s);
      if (!CP_PLAIN_LONG.has(name)) return true;
      if (name === 'preserve' && /(?:^|,)(?:links|all)(?:,|$)/.test(value)) return true;
      if (['suffix', 'target-directory'].includes(name) && !word.includes('=')) {
        at += 1;
      }
      continue;
    }
    for (let one = 1; one < word.length; one += 1) {
      if (!CP_PLAIN.includes(word[one])) return true;
      if (CP_VALUED.includes(word[one])) {
        if (one === word.length - 1) at += 1;
        break;
      }
    }
  }
  return false;
}

// madeBefore returns { paths, ends }: paths are the paths at which the commands of all make
// or move entries, from each folder of those commands, in order, in one list; ends[index] is
// the number of paths that the commands before the command of all at index make, or null
// when the guard cannot tell one of them. It charges a unit for each path that it adds.
function madeBefore(all) {
  const paths = [];
  const ends = [];
  let known = true;
  for (const one of all) {
    ends.push(known ? paths.length : null);
    if (!known) continue;
    const made = madeAt(one);
    if (made === null) {
      known = false;
      continue;
    }
    charge(1 + made.length * one.cwds.length);
    for (const each of made) for (const cwd of one.cwds) paths.push(path.resolve(cwd, each));
  }
  return { paths, ends };
}

// through reports whether word, a path word of segment, leads at or below one of the first
// end paths of made, from a folder of segment; with end null, each word does.
function through(word, segment, made, end, fold) {
  if (end === null) return true;
  return segment.cwds.some((cwd) => {
    for (let at = 0; at < end; at += 1) {
      charge();
      if (wild(word)) {
        if (globReach(path.resolve(cwd, word), made[at], fold, true) !== null) return true;
      } else if (under(fold(path.resolve(cwd, literal(word))), fold(made[at]))) return true;
    }
    return false;
  });
}

// copyParts returns { dest, sources } of a cp, install, ln or rsync of words: the folder of
// -t or --target-directory, else the last path, and the other paths, as patterns of patternOf.
function copyParts(words) {
  const plain = words.map(patternOf);
  let dest = null;
  const sources = [];
  for (let at = 1; at < plain.length; at += 1) {
    const word = plain[at];
    if (word === '-t' || word === '--target-directory') {
      dest = plain[at + 1] || '';
      at += 1;
    } else if (word.startsWith('--target-directory=')) dest = word.slice(19);
    else if (!word.startsWith('-')) sources.push(word);
  }
  if (dest === null) dest = sources.pop();
  return { dest, sources };
}

// contentsInto reports whether words, the words of a cp, copy the contents of a folder into
// the destination: a recursive option, -r, -R, -a, --recursive or --archive, with -T or
// --no-target-directory, as in cp -rT <folder> <destination>.
function contentsInto(words) {
  if (path.basename(words[0] || '') !== 'cp') return false;
  const end = words.indexOf('--');
  const options = words.slice(1, end < 0 ? words.length : end).filter((word) =>
    word.startsWith('-') && word !== '-');
  const has = (letters, long) => options.some((word) => long.includes(word) ||
    (!word.startsWith('--') && [...word.slice(1)].some((char) => letters.includes(char))));
  return has('rRa', ['--recursive', '--archive']) && has('T', ['--no-target-directory']);
}

// keepsPaths reports whether words, a cp or an rsync, write each source by its path below the
// destination: cp with --parents, --path or a prefix from --pa, as GNU getopt reads one, and
// rsync with -R, --relative or --files-from; rsync's popt reads no shortened long option.
function keepsPaths(words) {
  const tool = path.basename(words[0] || '');
  const end = words.indexOf('--');
  const options = words.slice(1, end < 0 ? words.length : end);
  if (tool === 'cp') {
    return options.some((word) => word.length >= 4 &&
      ['--parents', '--path'].some((name) => name.startsWith(word)));
  }
  return tool === 'rsync' && options.some((word) => word === '--relative' ||
    /^--files-from(?:=|$)/.test(word) || /^-[^-]*R/.test(word));
}

// movesInto reports whether words, a mv, move sources into dest, so that it removes the sources
// only: with -t or --target-directory, or with a source and no xargs or parallel in text, which
// add words; and with no other option for the destination, as in -ft, --target=x or -T. -t counts
// only after options with no value, since it is a value in -S -t and a file in -- -t.
function movesInto(text, words, dest, sources) {
  if (sources.includes(dest)) return false;
  const first = words.findIndex((word, at) => at > 0 &&
    !/^(?:-[^-tTS]+|--(?!su|t|no-t)[a-z-]+)$/.test(word));
  const given = /^(?:-t|--target-directory(?:=.*)?)$/s.test(words[first] || '');
  return !words.some((word, at) => /^(?:-[^-]*[tT]|--(?:no-)?t)/.test(word) &&
    !(given && at === first)) && (given || (sources.length > 0 && !FED.test(text)));
}

// unredirected returns words, as written, with no redirect and no file of one, as in 2>x or > x.
// A word with a quote or a backslash stays, unless the file is one whole quoted word, since a
// split can have left out a part of it.
function unredirected(words) {
  const odd = (word) => /['"\\]/.test(word.replace(/^(\d*[<>]+)?(["'])[^"'\\]*\2$/, ''));
  return words.filter((word, at) => odd(word) || (!/^\d*[<>]/.test(word) &&
    !(at > 0 && /^\d*[<>]+$/.test(words[at - 1]))));
}

// pathHits reports whether a simple command that writes changes full, as its words read once
// each is resolved from a folder of the command's cwds: a word that is full, or below full
// when folder is true, or a folder above full for a command of REMOVERS or, when full is a
// file, a restore or a checkout of a path. A checkout with no `--` reads a word as a path only
// when it exists, so `checkout .` is one and `checkout <name>` of a name that is no path is
// not. fold and realOf compare and resolve paths. With step, full is the folder of the step
// reports: a copy and a move read their words with no redirect, and a move that movesInto finds
// counts as a copy of its sources.
function pathHits(segment, full, folder, how, step = false) {
  const { fold, realOf, spend } = how;
  const words = plainWords(segment.words);
  const sub = subWrites(segment.words) ? words[subIndex(words)] : null;
  const remover = REMOVERS.has(path.basename(words[0])) || REMOVERS.has(sub);
  const restorer = sub === 'restore' || sub === 'checkout';
  const named = sub !== 'checkout' || words.includes('--');
  const target = fold(full);
  const nocase = fold('A') === 'a';
  const find = findParts(segment.words);
  if (find.writes) {
    // find writes the paths below each start that its -name options match.
    // The redirects of the text are find's, so an -exec command is read by its words.
    return find.exec.some((exec) => pathHits({ ...segment, words: exec, text: exec.join(' '),
      outputs: [] }, full, folder, how, step)) ||
      segment.cwds.some((cwd) => find.starts.some((start) => {
        spend();
        const at = fold(realOf(joined(cwd, start)));
        if (!under(target, at) && !(folder && under(at, target))) return false;
        return !find.names.length || find.names.some(({ pattern, nocase: other }) =>
          shown(full, folder, how.listed).some((name) => globMatch(pattern, name,
            { nocase: nocase || other, dots: true })));
      }));
  }
  // A copy into a folder above full writes full when a source has the name of the part of
  // full's path below that folder, or a source is vague or ends with /. A recursive cp with
  // -T or --no-target-directory copies the contents of its source into that folder.
  const tool = path.basename(words[0]);
  const copies = LAST_WRITTEN.has(tool);
  const moving = step && tool === 'mv';
  const args = step ? unredirected(segment.words) : segment.words;
  const { dest, sources } = copies || moving ? copyParts(args) : {};
  const moves = moving && !segment.cut && movesInto(segment.text, plainWords(args), dest, sources);
  if (copies || moves) {
    // A copy that keepsPaths finds writes a source by its path, as a copy of contents does.
    const into = contentsInto(words) || (step && keepsPaths(words));
    const named = (first) => into || sources.some((source) => vague(source) ||
      /\/\.?$/.test(source) ||
      globMatch(path.basename(source), first, { nocase, dots: segment.dots }));
    if (dest && !vague(dest) && wild(dest) && segment.cwds.some((cwd) => {
      spend();
      const pattern = path.resolve(cwd, dest);
      const depth = pattern.split(path.sep).filter(Boolean).length;
      return globReach(pattern, target, fold, segment.dots) === 'above' &&
        named(target.split(path.sep).filter(Boolean)[depth]);
    })) return true;
    if (dest && !vague(dest) && !wild(dest) && segment.cwds.some((cwd) => {
      spend();
      const resolved = realOf(joined(cwd, literal(dest)));
      const at = fold(resolved);
      if (at === target || !under(target, at)) return false;
      const stat = disk.stat(resolved);
      if (!dest.endsWith('/') && !(stat && stat.isDirectory())) return false;
      return named(path.relative(at, target).split(path.sep)[0]);
    })) return true;
  }
  return pathWords(segment).some((shown) => segment.cwds.some((cwd) => {
    spend(1 + (shown.length >> 8));
    const removes = remover && !(moves && shown === dest);
    if (wild(shown)) {
      // A glob writes each path it matches: full, a folder above it for a remover or a
      // restore, or a path below full when full is a folder.
      const reach = globReach(path.resolve(cwd, shown), target, fold, segment.dots);
      return reach === 'equal' || (reach === 'below' && folder) ||
        (reach === 'above' && (removes || (!folder && restorer)));
    }
    const word = literal(shown);
    const resolved = realOf(joined(cwd, word));
    const exact = fold(resolved);
    if (exact === target || (folder && under(exact, target))) return true;
    if (!under(target, exact)) return false;
    // A restore writes only tracked files, and .qory/build/ holds none.
    return removes || (!folder && restorer && (named || disk.exists(resolved)));
  }));
}

// countsAsWrite reports whether a call writes for the step count: it writes a file in
// artifacts, the artifact folder, which may lie in root/.qory/, or below root, the working
// folder, outside root/.qory/, or runs `qory artifact push`. cwd is the folder of the call,
// and all three, and each written path, are read through their links, a new file through
// the deepest folder above it that exists. A path of a shell command that vague reports, as
// in `~other/x`, `$HOME/x` or `"$f"`, counts as no write; a path that starts with ~ or ~+
// counts by the folder that it resolves to, as shellText reads it. A path through an entry
// that an earlier command of the call makes or moves, as madeBefore finds it, counts as no
// write. A write elsewhere in /tmp, mkdir, rmdir, chmod, chown, chgrp, chflags and a
// checkout with no `--` count as no write, and of cp, install, ln and rsync only the last
// path counts. A relative path of a shell command is read from the folder that walk finds
// for its command, after a cd, pushd, popd, -C or env -C, and counts as no write when that
// folder is unknown. A path with a wildcard counts as its folder before the first part with
// a wildcard. A call that needs more work than a budget allows, to deadline, a time in ms,
// counts as no write.
function countsAsWrite(name, input, place, deadline) {
  const spend = budget(deadline);
  setHome(process.env.HOME);
  try {
    return metered(spend, () => countWrite(name, input, place, spend));
  } catch (error) {
    if (error instanceof Spent) return false;
    throw error;
  }
}

// countWrite returns the answer of countsAsWrite, and spends a unit of spend for each path.
function countWrite(name, input, { cwd, root, artifacts }, spend) {
  const args = input !== null && typeof input === 'object' ? input : {};
  const nocase = caseless(root);
  const fold = (full) => (nocase ? full.toLowerCase() : full);
  const qory = fold(path.join(root, '.qory'));
  const known = new Map();
  const place = (lexical) => {
    spend();
    if (!known.has(lexical)) known.set(lexical, real(lexical));
    const full = fold(known.get(lexical));
    if (artifacts && under(full, fold(artifacts))) return true;
    return under(full, fold(root)) && !under(full, qory);
  };
  const work = (word, from = cwd) => (path.isAbsolute(word) ? place(word)
    : from !== null && place(joined(from, word)));
  if (Object.hasOwn(WRITE_TOOLS, name)) {
    return WRITE_TOOLS[name].some((key) => typeof args[key] === 'string' && args[key] !== '' &&
      work(args[key]));
  }
  if (name === 'apply_patch') return patchPaths(args.command || '').some((one) => work(one));
  if (name !== 'Bash') return false;
  const command = String(args.command || '');
  spend(command.length >> 10);
  if (command.includes(PATCH) && patchPaths(command).some((one) => work(one))) return true;
  const all = segments(command, cwd, (one) => segmentWrites(one) || opaque(one));
  // A path through an entry that an earlier command makes or moves is unknown: no write.
  const made = madeBefore(all);
  return all.some((whole, index) => {
    if (!segmentWrites(whole)) return false;
    // A word that starts with # starts a comment, which runs nothing.
    const cut = whole.words.findIndex((word) => word.startsWith('#'));
    if (cut === 0) return false;
    const segment = cut < 0 ? whole : { ...whole, words: whole.words.slice(0, cut) };
    const at = (word) => !vague(word) && !through(word, segment, made[index], fold) &&
      (wild(word) ? work(globFolder(word), segment.at) : work(literal(word), segment.at));
    const words = plainWords(segment.words);
    const tool = path.basename(words[0]);
    if (tool === 'qory' && words[1] === 'artifact' && words[2] === 'push') return true;
    const checkout = subWrites(segment.words) && words[subIndex(words)] === 'checkout' &&
      !words.includes('--');
    const targets = redirectTargets(segment);
    if (FOLDER_ONLY.has(tool) || checkout) return targets.some(at);
    const written = pathWords(segment);
    if (LAST_WRITTEN.has(tool)) return [...targets, ...written.slice(-1)].some(at);
    return written.some(at);
  });
}

// globFolder returns the folder of word, a pattern with a wildcard, before its first part
// with a wildcard, as in src for src/*/build, or . for *.log.
function globFolder(word) {
  const parts = word.split('/');
  const at = parts.findIndex((part) => wild(part));
  const folder = parts.slice(0, at).join('/');
  return literal(folder === '' && word.startsWith('/') ? '/' : folder || '.');
}

// names returns the ways a shell command can write full: its path, and its path from each
// folder of cwds and from root when it lies below them.
function names(full, cwds, root) {
  const out = new Set([full]);
  for (const from of [...cwds, root]) {
    const relative = path.relative(from, full);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) out.add(relative);
  }
  return [...out];
}

// decide returns the reason to deny a call, or null to let it run. input is the hook's input:
// tool_name, tool_input, cwd and, in an agent's call, agent_id; cwd only resolves the paths
// of the call. root is the working folder of the run, as rootOf of step-limit.cjs finds it;
// with no root, decide denies each write and shell command. locked returns the files of the
// lock, as lockedFiles does; it runs only for a write below root. lockKind returns the type of
// the lock, as lockTypeOf does. runFolder is the artifact
// folder of a run, as end-gate.cjs has it, unless the caller sets another. A call that needs more
// work than a budget allows, to deadline, a time in ms, is denied.
function decide(args) {
  const spend = budget(args.deadline);
  setHome((args.env || process.env).HOME);
  try {
    return metered(spend, () => decideCall({ ...args, spend }));
  } catch (error) {
    if (error instanceof Spent) return TOO_MUCH;
    throw error;
  }
}

// decideCall returns the answer of decide, and spends from spend.
function decideCall({ input, env = process.env, script = process.argv[1], locked, lockKind,
  root: start, spend, runFolder, runtime }) {
  if (!env.QORY_RUN_ID) return null;
  const call = kindOf(input.tool_name, input.tool_input);
  const session = reviewSession(env);
  if (call.kind === 'agent') {
    // A reviewer session starts no agent, as reviewReport reads it. Any other session starts
    // one, and an agent in the background is denied.
    const reviewer = reviewReport(env);
    return call.reason || (reviewer ? (reviewer.hook ? HOOK_NO_AGENT : REVIEW_NO_AGENT) : null);
  }
  // A reviewer session allows the tools of REVIEW_TOOLS and no other that is no write or shell:
  // a tool that the guard does not know is denied there, and allowed in any other session.
  // On Codex it allows the three tools of REVIEW_MCP too, for the main session and each agent.
  const reviewing = reviewReport(env);
  if (call.kind === null && reviewing && !REVIEW_TOOLS.has(input.tool_name) &&
    !(runtime === 'codex' && REVIEW_MCP.has(input.tool_name))) {
    return reviewToolDeny(input.tool_name, runtime, reviewing.hook);
  }
  if (call.kind !== 'write' && call.kind !== 'shell') return null;
  // reports-guard.cjs denies a write of .reports/*.json and a shell command that reaches
  // .reports/ other than checks.cjs alone, with the same reasons on each runtime. It reads a
  // shell command without the bodies that dropBodies finds to be text, which no command runs.
  const args = input.tool_name === 'apply_patch' ? { paths: call.paths }
    : call.kind === 'shell' ? { command: dropBodies(call.command) } : input.tool_input;
  // The files of a patch that the shell call runs are checked as those of apply_patch, as
  // dropBodies drops the patch, a body that apply_patch reads.
  // A shell command of read-only commands only reads .reports/, as a reader of a locked file.
  const reads = call.kind === 'shell' && readsOnlyCall(call.command,
    typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  const reports = (reads ? null : reportsGuard.decide({ kind: call.kind, env, script,
    cwd: input.cwd, args, globs: false })) || (call.kind === 'shell' && call.paths.length
    ? reportsGuard.decide({ kind: 'write', env, script, cwd: input.cwd,
      args: { paths: call.paths } }) : null);
  if (reports) return reports;
  // The guard reads the files that a shell command writes only from the paths in its text, so
  // the main session and each agent of a reviewer session run the commands of reviewShell only.
  if (call.kind === 'shell' && reviewing) {
    const folder = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
    const git = reviewHasGit(folder);
    const refused = reviewShell(call.command, git, folder);
    if (refused !== null) return reviewShellDeny(git, refused, reviewing.hook);
  }
  if (typeof start !== 'string' || start === '') return NO_ROOT;
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  const root = real(start);
  const build = path.join(root, BUILD);
  const nocase = caseless(root);
  const fold = (full) => (nocase ? full.toLowerCase() : full);
  const inside = (full, dir) => under(fold(full), fold(dir));
  const agent = typeof input.agent_id === 'string' && input.agent_id !== '';
  let typed;
  const typeOf = () => {
    if (typed === undefined) typed = (lockKind || lockTypeOf)({ root, env, script });
    return typed;
  };
  let lock = null;
  const lockOf = () => {
    if (lock === null) {
      lock = (locked || ((args) => lockedFiles(args)))({ root, env, script });
      lock = liftedLock(lock, { root, fold, type: agent ? typeOf() : null,
        name: agent ? reportName(input.agent_type, runtime, env.QORY_HARNESS_HOME) : null });
    }
    return lock;
  };
  const walked = call.paths.map((one) => walkPath(joined(cwd, one)));
  const paths = walked.map((one) => one.real);
  const home = steps.homeBelow(env.QORY_HARNESS_HOME, root);
  const reviewer = agent && /-reviewer$/.test(String(input.agent_type));
  const artifacts = artifactFolder(root, env, runFolder);
  const kept = keptFiles(env, session, nocase, root, artifacts);
  const refusedStart = call.kind === 'shell' && agent ? refusedShell(typeOf(), call.command)
    : null;
  if (refusedStart !== null) return `${refusedStart}The command is ${reviewShown(call.command)}.`;
  if (call.kind === 'shell' && !reads && !reportsGuard.runsChecks(call.command, env, script)) {
    const dirs = (name) => [...new Set([artifactFolder(root, env, runFolder),
      path.join(root, '.qory', 'artifacts')].filter(Boolean)
      .map((dir) => fold(path.join(dir, name))))];
    const reason = reportsGlob(call.command, cwd, dirs('.reports'), fold);
    if (reason) return reason;
    if (STEP_FOLDER.test(args.command)) return `${STEP_KEPT}The command has .step-reports.`;
    const hidden = reportsGlob(call.command, cwd, dirs(STEP_REPORTS), fold, STEP_KEPT,
      STEP_FOLDER);
    if (hidden) return hidden;
  }
  // A reviewer agent of a review session writes its report with Write or apply_patch only.
  if (call.kind === 'shell' && session && reviewer && !reads) {
    return `${SESSION_SHELL}The command is ${reviewShown(call.command)}.`;
  }
  const segs = call.kind === 'shell' && session && artifacts && !reads
    ? segments(call.command, cwd) : null;
  if (segs) {
    const refused = pushDeny(call.command, artifacts, nocase,
      segs.flatMap((one) => plainWords(one.words)));
    if (refused) return refused;
    // versions.cjs copy would write a stored version over the draft, and nothing else of
    // versions.cjs is run here but compare.
    const mentions = segs.some((one) => plainWords(one.words).some((word) =>
      /versions\.cjs/.test(word)));
    if ((mentions || /versions\.cjs/.test(call.command)) &&
      !comparesVersions(call.command, env, script)) {
      return `${VERSIONS_KEPT}The command is ${reviewShown(call.command)}.`;
    }
  }
  if (call.kind === 'shell') {
    const reason = readShell(call.command, { cwd, root, lockOf, nocase, home, spend, kept,
      exempt: sessionExempt(call.command, env, script),
      alone: reportsGuard.runsChecks(call.command, env, script),
      checks: reviewChecks(call.command, env, script),
      checked: (checksVerb(call.command, env, script) || [])[0] === 'check' ||
        comparesVersions(call.command, env, script) });
    // The other rules of a review session give their reasons first; this one stops the rest.
    if (!reason && segs && !pushedFrom(call.command) && !artifactVerb(call.command, env, script)) {
      const word = artifactNamed(segs, artifacts, nocase);
      if (word !== null) return `${ARTIFACTS_KEPT}The command has ${reviewShown(word)}.`;
    }
    if (reason || !paths.length) return reason;
  }
  const homed = home && paths.find((full) => inside(full, home));
  if (homed) return `${HOMED}${home}; the call writes ${homed}.`;
  const built = paths.find((full) => inside(full, build) ||
    fold(full).includes(fold(`${path.sep}${BUILD}${path.sep}`)));
  if (built) return `${BUILT}The call writes ${built}.`;
  if (paths.some((full) => inside(full, root))) {
    const { files = [], what, problem, type } = lockOf();
    if (problem) return unread({ type, problem });
    const file = paths.find((full) => files.some((one) => fold(one) === fold(full)));
    if (file) return lockedReason(file, root, what);
  }
  const unsure = walked.find((one) => one.unsure);
  if (unsure) return `${UNSURE}The call writes ${unsure.real}.`;
  const shielded = keptWrite(kept, paths);
  // In a review session an agent whose type ends in -reviewer writes its report only, and
  // no other call writes in the report folder.
  if (session && reviewer) {
    return shielded && shielded.inputs ? shielded.reason
      : sessionDeny({ call, input, paths, root, cwd, nocase, session, runtime, env });
  }
  if (agent && !session && !reviewing &&
    steps.STEP_REVIEWERS.has(reportName(input.agent_type, runtime, env.QORY_HARNESS_HOME))) {
    return stepReport({ call, input, env, runtime, start, runFolder }) ? null
      : `${STEP_ONLY}The call writes ${paths.join(', ')}.`;
  }
  const stepped = paths.find((full) => STEP_FOLDER.test(full));
  if (stepped) return `${STEP_KEPT}The call writes ${stepped}.`;
  // shortcut: in a review session the main session and agents other than reviewers keep
  // the rules of the run, as at access write-no-push: the guard does not tell access read
  // from write-no-push. qory's read-only mount of the checkout enforces read; keep it so.
  if (shielded) return shielded.reason;
  if (agent) {
    // The write tools are denied to an agent whose type ends in -reviewer, such as a reviewer
    // of a draft, and to each agent of a reviewer session, whatever its type. Any other agent
    // writes. The first kind has no reviewShell here, only the other rules for a shell.
    return /-reviewer$/.test(String(input.agent_type)) || reviewing ? reviewDeny({
      call, input, paths, env, root, nocase, agent: true }) : null;
  }
  if (reviewing) return reviewDeny({ call, input, paths, env, root, nocase });
  const outside = paths.find((full) => !artifacts || !inside(full, artifacts));
  if (!outside) return null;
  if (!artifacts) {
    return `${LINKED}${folder(root, env, runFolder)} is a link; this call writes ${outside}.`;
  }
  return `${MAIN}${artifacts}; this call writes ${outside}.`;
}

// A sed script that only prints, deletes or substitutes in its output, as in 1,20p, /x/p or
// s/a/b/g: no w, W, e or r command and no w or e flag.
const SED_READS = /^(?:[\d,$]*[pdq=]?|\/[^/]*\/[pd]?|s(.)(?:(?!\1).)*\1(?:(?!\1).)*\1[gpI\d]*)$/;

// opaque reports whether segment, a simple command, can write files that the guard does not
// read: a command with a prefix option that commandWords marks blind is; otherwise it is no
// write that the guard reads, and no command of READ_ONLY with only the
// options that readsOnly allows, with a subcommand of SUB_WRITERS, which subWrites reads, or
// of SHAPES, after the words of CONDITIONS. A shell with -c and a quoted text, which
// commands reads, is not opaque, and sed is not with scripts that SED_READS matches. find is
// opaque when a command of its -exec is.
function opaque(segment) {
  if (segment.blind) return true;
  if (segmentWrites(segment)) return false;
  const words = plainWords(segment.words);
  let at = 0;
  while (at < words.length && CONDITIONS.has(words[at])) at += 1;
  if (at >= words.length || SHAPES.has(words[at])) return false;
  const rest = words.slice(at);
  const name = path.basename(rest[0]);
  // A read-only command has no subcommand: in `rg --pre rm x <path>`, rm is the value of an
  // option outside the list of rg, which makes rg opaque.
  if (!READ_ONLY.has(name) && SUB_WRITERS.has(rest[subIndex(rest)])) return false;
  if (SHELL_NAMES.test(name)) {
    const raw = segment.words.slice(words.length - rest.length);
    const at = rest.findIndex((word) => /^-[A-Za-z]*c[A-Za-z]*$/.test(word));
    return at < 0 || !/^\$?['"]/.test(raw[at + 1] || '');
  }
  // A variable can change what a read-only command runs, as RIPGREP_CONFIG_PATH, LESSOPEN,
  // PAGER or GREP_OPTIONS do: such a command with a variable setting is opaque.
  if (segment.vars && (READ_ONLY.has(name) || name === 'sed') && !CD.has(name)) return true;
  if (name === 'sed') {
    const scripts = [];
    let file = false;
    for (let one = 1; one < rest.length; one += 1) {
      if (rest[one] === '-e' || rest[one] === '--expression') scripts.push(rest[(one += 1)] || '');
      else if (rest[one].startsWith('--expression=')) scripts.push(rest[one].slice(13));
      else if (/^-[a-zA-Z]*f$|^--file/.test(rest[one])) file = true;
      else if (!rest[one].startsWith('-') && !scripts.length && !file) scripts.push(rest[one]);
    }
    return file || !scripts.length || scripts.some((one) => one.split(/[;\n]/)
      .some((part) => !SED_READS.test(part.trim())));
  }
  if (!READ_ONLY.has(name)) return true;
  if (name === 'find') {
    for (let one = 1; one < rest.length; one += 1) {
      if (!/^-(?:exec|execdir|ok|okdir)$/.test(rest[one])) continue;
      let end = one + 1;
      while (end < rest.length && rest[end] !== ';' && rest[end] !== '+') end += 1;
      const exec = rest.slice(one + 1, end);
      if (exec.length && opaque({ words: exec, text: exec.join(' '), outputs: [] })) return true;
      one = end;
    }
  }
  return !readsOnly(name, rest);
}

// readsOnly reports whether words, a command of READ_ONLY named name and its words, have only
// the options of READ_ONLY. A word after -- or that does not start with - is no option, nor
// is the value of an option that takes one.
function readsOnly(name, words) {
  const { short = '', valued = '', long = [] } = READ_ONLY.get(name);
  if (short === '*') return true;
  charge(1 + (words.length >> 6));
  for (let at = 1; at < words.length; at += 1) {
    const word = words[at];
    if (word === '--' && name !== 'find') return true;
    if (!word.startsWith('-') || word === '-') continue;
    if (name === 'find') {
      if (/^-(?:exec|execdir|ok|okdir)$/.test(word)) {
        while (at < words.length && words[at] !== ';' && words[at] !== '+') at += 1;
        continue;
      }
      const primary = word.slice(1);
      if (/^O\d*$/.test(primary)) continue;
      if (!FIND_PRIMARIES.has(primary)) return false;
      if (FIND_VALUED.has(primary)) at += 1;
    } else if (word.startsWith('--')) {
      if (!long.includes(word.slice(2).split('=')[0])) return false;
    } else {
      for (let one = 1; one < word.length; one += 1) {
        if (!short.includes(word[one])) return false;
        if (valued.includes(word[one])) {
          if (one === word.length - 1) at += 1;
          break;
        }
      }
    }
  }
  return true;
}

// reaches returns the first word of the texts of parts that reaches one of files or a folder
// above one below root, from a folder of its command, after links: a word that resolves to
// it, a wildcard that can match it, or the name of a file of files, as in 'a.ts' for
// checks/a.ts. root itself and the folders above it are no folder that reaches: a command
// with no path runs over all of root already. folder, a folder, is reached by a word in it or
// above it below root, but not by its name. It returns { word, file }, or null. A word of a
// command whose folder is lost, after eval, source, . or a cd to a vague folder, is read from
// cwd, the working folder of the call, as well as by its name, and an absolute word from
// any folder. The folder of a cd, which walk follows, is no word that reaches.
function reaches(parts, files, folder, root, { realOf, fold, spend, cwd }, skip = null) {
  const top = fold(root);
  const depth = top.split(path.sep).filter(Boolean).length;
  // The paths that a word reaches, each file and each folder above it below root, with the
  // file they reach, and the names of files of word characters.
  const reached = new Map();
  const named = new Map();
  const odd = [];
  const targets = [...files, folder];
  for (const file of targets) {
    spend(1 + (file.length >> 8));
    for (let at = fold(file); under(at, top) && at !== top; at = path.dirname(at)) {
      if (!reached.has(at)) reached.set(at, file);
    }
    if (file === folder) continue;
    const name = fold(path.basename(file));
    if (/^[\w.-]+$/.test(name)) named.set(name, file);
    else odd.push({ name, file });
  }
  const longest = Math.max(0, ...[...named.keys()].map((name) => name.length));
  const full = fold(folder);
  const left = skip && fold(skip);
  const hit = (at) => reached.get(at) ||
    (under(at, full) && !(left && under(at, left)) ? folder : null);
  // reachedIn returns { word, file } of the first word of raw, a text of the command one,
  // that reaches a file, or null. With plain, raw is a word without quotes, read as it is.
  const reachedIn = (raw, plain, one) => {
    const text = fold(raw);
    // A name reaches where no word character or . comes before it and no word character
    // after it: it starts a run of word characters, dots and dashes, and a dot or the end of
    // the run follows it.
    for (const run of text.match(/[\w.-]+/g) || []) {
      const end = Math.min(run.length, longest);
      spend(1 + (end >> 6));
      for (let at = 1; at <= end; at += 1) {
        if (at < run.length && run[at] !== '.') continue;
        const file = named.get(run.slice(0, at));
        if (file) return { word: path.basename(file), file };
      }
    }
    for (const { name, file } of odd) {
      spend(1 + (text.length >> 10));
      for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
        spend();
        if (!/[\w.-]/.test(text[at - 1] || '') && !/[\w-]/.test(text[at + name.length] || '')) {
          return { word: path.basename(file), file };
        }
      }
    }
    for (const token of raw.match(TOKEN) || []) {
      if (vague(token)) continue;
      for (const from of one.lost ? [cwd] : one.cwds) {
        spend();
        if (!wild(token)) {
          const file = hit(fold(realOf(joined(from, plain ? token : unquote(token)))));
          if (file) return { word: token, file };
          continue;
        }
        const pattern = path.resolve(from, plain ? token : patternOf(token));
        // A wildcard reaches a file that it matches, or a folder above one below root.
        if (pattern.split(path.sep).filter(Boolean).length <= depth) continue;
        const file = targets.find((each) => ['equal', 'above'].includes(
          globReach(pattern, fold(each), fold, true)));
        if (file) return { word: token, file };
      }
    }
    return null;
  };
  for (const one of parts) {
    if (one.words.length && CD.has(path.basename(one.words[0]))) continue;
    // The text of the command, and each of its words after the shell removes quotes and
    // expands braces, as in ch''ecks, $'\x63hecks' or {c..c}hecks.
    for (const [index, raw] of [one.text, ...plainWords(one.words)].entries()) {
      const found = reachedIn(raw, index > 0, one);
      if (found) return found;
    }
  }
  return null;
}

// readShell returns the reason to deny a shell command: it writes .qory/build/, home, the
// harness home below the working folder, or a file of the lock, as its text shows, or an
// opaque command of it reaches one of them. lockOf returns the files of the lock; with
// nocase, a name matches in any case. It spends a unit of spend for each comparison.
function readShell(command, { cwd, root, lockOf, nocase, home, spend, kept = [], exempt,
  alone, checks, checked }) {
  spend(command.length >> 10);
  const all = segments(command, cwd);
  const parts = all.filter(segmentWrites);
  // A writer or an opaque command that xargs or parallel runs takes its paths from its
  // input, which the guard does not read.
  const dark = all.find(opaque) || all.find((one) => FED.test(one.text) &&
    (segmentWrites(one) || opaque(one))) || all.find(shellArgs);
  if (!parts.length && !dark) return null;
  const cwds = [...new Set(parts.flatMap((one) => one.cwds))];
  const known = new Map();
  const realOf = (full) => {
    if (!known.has(full)) known.set(full, real(full));
    return known.get(full);
  };
  const how = { realOf, spend, cwd, listed: new Map(),
    fold: (full) => (nocase ? full.toLowerCase() : full) };
  const hit = (full, folder, step) => parts.some((one) => pathHits(one, full, folder, how,
    step)) ||
    names(full, cwds, root).some((name) => parts.some((one) => {
      spend(1 + (one.text.length >> 12));
      return writes(one, name, nocase);
    }));
  const fold = how.fold;
  const qory = path.join(root, '.qory');
  for (const one of parts) {
    if (!MODES.has(path.basename(unquote(one.words[0])))) continue;
    if (fold(one.text).includes(fold('.qory'))) return `${MODED}${one.text.trim()}.`;
    const word = pathWords(one).find((each) => one.cwds.some((cwd) => {
      spend();
      return globMeets(path.resolve(cwd, each), qory, how, one.dots);
    }));
    if (word !== undefined) return `${MODED}${word}.`;
  }
  if (hit(path.join(root, BUILD), true) || parts.some((one) => writes(one, BUILD, nocase))) {
    return `${BUILT}The command writes .qory/build/.`;
  }
  if (home && hit(home, true)) return `${HOMED}${home}; the command writes in it.`;
  for (const one of kept.filter((each) => !each.deep)) {
    const target = (one.shell || [one.full]).find((full) => hit(full, one.folder, one.step));
    if (target) return `${one.head}The command writes ${one.folder ? 'in ' : ''}${target}.`;
  }
  const { files = [], what, problem, type } = lockOf();
  if (problem) return unread({ type, problem });
  const file = files.find((full) => hit(full, false));
  if (file) return lockedReason(file, root, what);
  // A command whose writes the guard does not read: a locked file or .qory/build/ in the text
  // of the call denies it.
  const reached = dark && reaches(all, files, path.join(root, BUILD), root, how);
  if (reached) {
    const shown = under(reached.file, root) ? path.relative(root, reached.file) : reached.file;
    const fed = FED.exec(dark.text);
    const name = `${fed ? `${fed[2]} ` : ''}${path.basename(dark.words[0])}`;
    return `${reached.file === path.join(root, BUILD) ? BUILT : OPAQUE}The guard cannot tell ` +
      `what ${name} writes, and the call contains ${reached.word}, which reaches ${shown}.`;
  }
  // A command whose writes the guard does not read, other than one of sessionExempt, writes
  // no word that reaches the report folder of a review session.
  // Nor does it, other than the checks script alone, reach .step-reports of the artifact folder;
  // the guard does not read what tar, unzip and ditto extract, as a script that writes there.
  const scripts = all.filter((one) => !/^(?:tar|unzip|ditto)$/
    .test(path.basename(plainWords(one.words)[0] || '')));
  for (const one of dark ? kept.filter((each) => (each.folder && !each.home && !each.deep &&
    !(each.step ? alone : exempt)) ||
    (each.matrix && !checked)) : []) {
    const found = reaches(one.step ? scripts : all, [], one.full, root, how);
    if (found) {
      return `${one.head}The guard cannot tell what ${path.basename(dark.words[0])} writes, ` +
        `and the call contains ${found.word}.`;
    }
  }
  // Nor does such a command, other than the checks script, run in the harness home or contain
  // a word that reaches it, outside a working folder in the home, except the file of the home
  // that it runs, as node <home>/x.cjs, in a call with no quotes, parentheses or $.
  const plain = !/['"`()$\\{}]/.test(command);
  for (const one of dark && !checks ? kept.filter((each) => each.home) : []) {
    const skip = under(fold(root), fold(one.full)) ? root : null;
    const inHome = (at) => under(fold(at), fold(one.full)) &&
      !(skip && under(fold(at), fold(skip)));
    for (const segment of all) {
      const inside = segment.cwds.find((at) => inHome(realOf(at)));
      const found = inside ? { word: inside } : reaches([plain ? withoutScript(segment, inHome,
        realOf) : segment], [], one.full, root, how, skip);
      if (found) {
        return `${one.head}The guard cannot tell what ${path.basename(dark.words[0])} writes, ` +
          `and the call contains ${found.word}.`;
      }
    }
  }
  for (const one of parts) {
    if (!one.lost) continue;
    const word = pathWords(one).concat(findParts(one.words).writes ? findParts(one.words).starts
      : []).find((each) => !vague(each) && !each.startsWith('/'));
    if (word !== undefined) return `${LOST}The command writes ${word}.`;
  }
  // A write through an entry that an earlier command of the call makes or moves: the guard
  // reads its path as it is now.
  const made = madeBefore(all);
  const writers = new Set(parts);
  for (const [index, one] of all.entries()) {
    const end = made.ends[index];
    if (!writers.has(one) || end === 0) continue;
    const word = pathWords(one).find((each) => !vague(each) &&
      through(each, one, made.paths, end, fold));
    if (word !== undefined) return `${LINK_MADE}The command writes ${word}.`;
  }
  for (const one of parts) {
    const word = pathWords(one).find((each) => !vague(each) && !wild(each) &&
      one.cwds.some((from) => {
        spend();
        return walkPath(joined(from, literal(each))).unsure;
      }));
    if (word !== undefined) return `${UNSURE}The command writes ${word}.`;
  }
  // tar or unzip that extracts into a folder above full writes the files of its archive there.
  const unpacked = (full) => all.some((one) => {
    if (!/^(?:tar|unzip)$/.test(path.basename(plainWords(one.words)[0] || ''))) return false;
    const into = madeAt(one);
    return Array.isArray(into) && into.some((dir) => one.cwds.some((from) => {
      spend();
      return under(fold(full), fold(realOf(joined(from, dir))));
    }));
  });
  const matrixFile = kept.find((one) => one.matrix && unpacked(one.full));
  if (matrixFile) return `${matrixFile.head}The command extracts into a folder above it.`;
  return null;
}

// wild reports whether word has a wildcard of the shell, *, ? or [, that no backslash escapes.
function wild(word) {
  for (let at = 0; at < word.length; at += 1) {
    if (word[at] === '\\') at += 1;
    else if (word[at] === '*' || word[at] === '?' || word[at] === '[') return true;
  }
  return false;
}

// literal returns word without the backslashes that escape its characters.
const literal = (word) => word.replace(/\\(.)/g, '$1');

// globParts returns the parts of part, one part of a path with wildcards: { kind: 'char',
// char }, { kind: 'any' } for ?, { kind: 'star' } for one or more *, and { kind: 'class',
// negate, items, bad } for [...], whose items are [low, high] ranges. A range whose low is
// above its high makes bad true, and a [ with no ] is a char.
function globParts(part) {
  if (parsed.part === part) return parsed.tokens;
  charge(1 + (part.length >> 8));
  const out = [];
  // The last ], past which no [ starts a class.
  const last = part.lastIndexOf(']');
  for (let at = 0; at < part.length; at += 1) {
    const one = part[at];
    if (one === '\\' && at + 1 < part.length) {
      at += 1;
      out.push({ kind: 'char', char: part[at] });
    } else if (one === '*') {
      if (!out.length || out[out.length - 1].kind !== 'star') out.push({ kind: 'star' });
    } else if (one === '?') out.push({ kind: 'any' });
    else if (one === '[' && classEnd(part, at, last) > 0) {
      const end = classEnd(part, at, last);
      let body = part.slice(at + 1, end);
      const negate = body.startsWith('!') || body.startsWith('^');
      if (negate) body = body.slice(1);
      const items = [];
      for (let k = 0; k < body.length; k += 1) {
        if (body[k + 1] === '-' && k + 2 < body.length) {
          items.push([body[k], body[k + 2]]);
          k += 2;
        } else items.push([body[k], body[k]]);
      }
      out.push({ kind: 'class', negate, items, bad: items.some(([low, high]) => low > high) });
      at = end;
    } else out.push({ kind: 'char', char: one });
  }
  parsed.part = part;
  parsed.tokens = out;
  return out;
}

// The part that globParts read last, and its tokens: globMatch reads one pattern with many
// names.
const parsed = { part: null, tokens: null };

// classEnd returns the index of the ] that closes the [ at at in part, or -1. A ] right after
// the [ or after its ! or ^ is a member. last is the index of the last ] of part, so that a [
// after it costs no search.
function classEnd(part, at, last) {
  let from = at + 1;
  if (part[from] === '!' || part[from] === '^') from += 1;
  return last < from + 1 ? -1 : part.indexOf(']', from + 1);
}

// globMatch reports whether name, one part of a path, matches part, one part of a pattern. It
// walks both once, and goes back only to the last *, so its time grows with the product of
// their lengths, never more. Without dots, a name that starts with . needs a . at the start
// of part, as the shell does without dotglob. With nocase, letters match in any case.
function globMatch(part, name, { nocase = false, dots = false } = {}) {
  const tokens = globParts(part);
  charge(1 + ((tokens.length * (name.length + 1)) >> 10));
  const first = tokens[0];
  if (!dots && name.startsWith('.') && !(first && first.kind === 'char' && first.char === '.')) {
    return false;
  }
  const fold = (one) => (nocase ? one.toLowerCase() : one);
  const one = (token, char) => {
    if (token.kind === 'any') return true;
    if (token.kind === 'char') return fold(token.char) === fold(char);
    if (token.bad) return false;
    const hit = token.items.some(([low, high]) => (fold(low) <= fold(char) &&
      fold(char) <= fold(high)) || (low <= char && char <= high));
    return token.negate ? !hit : hit;
  };
  let t = 0;
  let n = 0;
  let star = -1;
  let mark = 0;
  while (n < name.length) {
    const token = tokens[t];
    if (token && token.kind === 'star') {
      star = t;
      t += 1;
      mark = n;
    } else if (token && one(token, name[n])) {
      t += 1;
      n += 1;
    } else if (star >= 0) {
      t = star + 1;
      mark += 1;
      n = mark;
    } else return false;
  }
  while (t < tokens.length && tokens[t].kind === 'star') t += 1;
  return t === tokens.length;
}

// globMeets reports whether pattern, a full path that may have wildcards, matches dir, a
// path below dir, or a folder above dir. realOf and fold resolve and compare paths.
function globMeets(pattern, dir, { realOf, fold }, dots) {
  if (!wild(pattern)) {
    const full = fold(realOf(literal(pattern)));
    return under(full, fold(dir)) || under(fold(dir), full);
  }
  return globReach(pattern, dir, fold, dots) !== null;
}

// globReach returns how pattern, a full path with wildcards, meets full: 'equal' when it
// matches full, 'above' when it matches a folder above full, 'below' when it matches only
// paths below full, and null when it matches none of them. fold compares the parts, and with
// dots a wildcard matches a leading dot. The parts before the first wildcard are read through
// their links, as the shell reads them; a wildcard that matches a link is not followed.
function globReach(pattern, full, fold, dots) {
  charge(1 + ((pattern.length + full.length) >> 8));
  const parts = linked(pattern).split(path.sep).filter(Boolean);
  const wanted = full.split(path.sep).filter(Boolean);
  const nocase = fold('A') === 'a';
  const meets = parts.slice(0, wanted.length).every((part, at) => (wild(part)
    ? globMatch(part, wanted[at], { nocase, dots }) : fold(literal(part)) === fold(wanted[at])));
  if (!meets) return null;
  if (parts.length === wanted.length) return 'equal';
  return parts.length < wanted.length ? 'above' : 'below';
}

// linked returns pattern, a full path, with its parts before the first wildcard read through
// their links, and the wildcard characters and backslashes of that real path escaped.
function linked(pattern) {
  const parts = pattern.split(path.sep);
  const at = parts.findIndex((part) => wild(part));
  if (at <= 0) return pattern;
  charge();
  const head = real(literal(parts.slice(0, at).join(path.sep)) || path.sep);
  return [head.replace(/[\\*?[]/g, '\\$&'), ...parts.slice(at)].join(path.sep);
}

// lockedReason returns the deny of a write to file, which the lock what lists. The path is on
// the second line, so that the first line stays within 100 characters.
function lockedReason(file, root, what) {
  const shown = under(file, root) ? path.relative(root, file) : file;
  return `Leave the locked file as it is: ${what} locks it.\nThe call writes ${shown}. ` +
    "A change to a locked file fails Verify's lock --verify --version <N>.";
}

// placeOf returns { cwd, root, artifacts } of a call: the folder of the hook's input, root
// and the artifact folder, as artifactFolder finds it, read through their links.
function placeOf(input, root, env) {
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  return { cwd, root: real(root), artifacts: artifactFolder(root, env) };
}

// reportsGlob returns the deny of reports-guard.cjs for a word of command that contains .reports
// after brace expansion, as segments reads the words, or that has a wildcard and can match a
// folder of dirs, the .reports folders of the artifact folders, or a path below it, from a
// folder of its command, or null. reports-guard.cjs finds
// such a word with fs.globSync, which has no limit on its work; globReach has one. head and
// named are the deny and the pattern of another folder in place of .reports.
function reportsGlob(command, cwd, dirs, fold, head = reportsGuard.HIDDEN_REASON,
  named = reportsGuard.REPORTS) {
  for (const one of segments(command, cwd)) {
    for (const raw of one.words) {
      for (const each of braces(raw)) {
        const plain = unquote(each);
        if (named.test(plain)) {
          return `${head}The shell turns the word ${raw} into ${plain}.`;
        }
        if (!wild(each) || vague(each)) continue;
        for (const from of one.cwds) {
          for (const dir of dirs) {
            charge();
            const how = globReach(path.resolve(from, patternOf(each)), dir, fold, one.dots);
            if (how === 'equal' || how === 'below') {
              return `${head}The glob ${raw} matches ${dir}.`;
            }
          }
        }
      }
    }
  }
  return null;
}

// reviewReport returns { report, hook } for a session of a reviewer, or null for any other
// session. qoryInputs of end-gate.cjs reads the inputs.json that qory wrote at
// $QORY_HARNESS_HOME: a link, a file that is no JSON or a file of more than 1 MiB counts as
// none. A session is a reviewer's in two cases:
// - inputs.json has the member qory.hook_session, HOOK_SESSION, with any value: the session of
//   a hook's agent, with hook true. report is qory.hook_session.report. A value that is no
//   object leaves the session no report, so it writes no file.
// - inputs.json has the member qory.review as an object, and no qory.hook_session, with hook
//   false. report is qory.review.report. qory writes qory.review only in a reviewer session,
//   not in the session that builds the change.
// report is the member when it is a normalised absolute path: no relative path, no . or ..
// part, no empty part from a double slash, no trailing slash, no NUL and at most PATH_MAX
// characters; otherwise null, and the session of the reviewer writes no file.
function reviewReport(env) {
  const qory = qoryInputs(env);
  if (qory && Object.hasOwn(qory, HOOK_SESSION)) {
    const hook = qory[HOOK_SESSION];
    return { report: member(hook) && normalPath(hook.report) ? hook.report : null, hook: true };
  }
  const review = qory && qory.review;
  if (!member(review)) return null;
  return { report: normalPath(review.report) ? review.report : null, hook: false };
}

// member reports whether value is a JSON object: no null and no array.
const member = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// normalPath reports whether one is a normalised absolute path, as reviewReport describes.
const normalPath = (one) => typeof one === 'string' && one.length <= PATH_MAX &&
  !one.includes('\0') && path.isAbsolute(one) && path.normalize(one) === one &&
  !one.endsWith(path.sep);

const REVIEW_ONLY = 'Write only qory.review.report, with Write or apply_patch: a reviewer writes ' +
  'no other file.\nThe path is in inputs.json of the harness home; a link, a file with more than ' +
  'one link and a path below .git or .claude of the working folder are denied. ';
const REVIEW_NONE = 'Stop the review and write no file: qory.review.report cannot be used.\n' +
  'It must be an absolute path with no . or .. part, no double or trailing slash. ';
const REVIEW_AGENT = 'Report in your text: the write tools are denied to a reviewer agent.\n' +
  'It applies to each agent of a reviewer session and to each agent whose type ends in ' +
  '-reviewer. ';
const REVIEW_NO_AGENT = 'Start no agent: a reviewer reads the change and writes its report ' +
  'itself.\nThe session has qory.review in inputs.json of the harness home.';
// The denies of a hook session, as those of a reviewer for the member HOOK of inputs.json.
const HOOK = `qory.${HOOK_SESSION}`;
const HOOK_ONLY = `Write only ${HOOK}.report, with Write or apply_patch: a hook ` +
  'session writes no other file.\nThe path is in inputs.json of the harness home; a link, a ' +
  'file with more than one link and a path below .git or .claude of the working folder are ' +
  'denied. ';
const HOOK_NONE = `Report in your text and write no file: ${HOOK}.report cannot be ` +
  'used.\nIt must be an absolute path with no . or .. part, no double or trailing slash. ';
const HOOK_AGENT = 'Report in your text: the write tools are denied to an agent of a hook ' +
  `session.\nOnly the main session of a hook session writes ${HOOK}.report. `;
const HOOK_NO_AGENT = 'Start no agent: the agent of a hook reads the work and writes its ' +
  `report itself.\nThe session has ${HOOK} in inputs.json of the harness home.`;
// The tools of a reviewer session besides the report write and the shell: the read tools and
// two tools that only plan.
const REVIEW_TOOLS = new Set(['Read', 'Grep', 'Glob', 'Skill', 'TodoWrite', 'update_plan']);
// The read tools of the qory review server, allowed on Codex by exact name. Codex sends
// mcp__, the server id, __ and the tool name as tool_name (source of rust-v0.169.0).
const REVIEW_MCP_PREFIX = 'mcp__qory_review__';
const REVIEW_MCP_TOOLS = ['read_file', 'list_directory', 'search_in_files'];
const REVIEW_MCP = new Set(REVIEW_MCP_TOOLS.map((one) => `${REVIEW_MCP_PREFIX}${one}`));
// reviewShown returns text for a deny line: printable ASCII only, at most size characters.
const reviewShown = (text, size = 60) => String(text).replace(/[^\x20-\x7e]/g, '?').slice(0, size);
const reviewToolDeny = (name, runtime, hook) => 'Use Read, Grep, Glob, a read shell or the ' +
  `report Write, not ${reviewShown(name, 28)}.\n` +
  `A ${hook ? 'hook' : 'reviewer'} session denies the tool ${reviewShown(name)}.` +
  (runtime === 'codex' ? ` On Codex it allows ${[...REVIEW_MCP].join(', ')}.` : '');
// The options of each command of a reviewer's shell. flags are short options with no value,
// valued short options with a value, long and longValued long options without and with a
// value (after = or as the next word). noPlus refuses a word that starts with +.
const REVIEW_OPTIONS = {
  cat: { flags: 'nbsAETv' },
  head: { flags: '0123456789qv', valued: 'nc' },
  tail: { flags: '0123456789qv', valued: 'nc', noPlus: true },
  ls: { flags: 'laA1RhdtrSFp' },
  wc: { flags: 'lwcm' },
  grep: { flags: 'nivwxFErRlLcoHhs', valued: 'eABC', longValued: ['include', 'exclude'] },
  rg: { flags: 'inNSsFwxclovHIq', valued: 'egtTmABC',
    long: ['files', 'hidden', 'no-ignore', 'files-with-matches', 'count', 'line-number',
      'no-line-number', 'ignore-case', 'smart-case', 'case-sensitive', 'fixed-strings',
      'word-regexp', 'invert-match', 'only-matching', 'no-heading', 'heading'],
    longValued: ['glob', 'type', 'type-not', 'max-count', 'max-depth', 'context',
      'after-context', 'before-context', 'regexp'] },
  pwd: { flags: 'LP' },
  sort: { flags: 'urnf', valued: 'kt' },
  cut: { flags: 's', valued: 'fdcb' },
  diff: { flags: 'urqwb' },
};
// The same for git, by subcommand, in a folder with git. A --format or --pretty value with
// %G, %+G, %-G or % G starts gpg, so it is refused.
const GIT_STAT = ['stat', 'name-only', 'name-status', 'shortstat', 'numstat', 'no-color'];
const GIT_GPG = /%[-+ ]?G/;
const REVIEW_GIT = {
  diff: { flags: 'wbp', valued: 'U',
    long: [...GIT_STAT, 'cached', 'staged', 'exit-code', 'quiet'], longValued: ['diff-filter'] },
  show: { flags: 'wsp', valued: 'U', long: [...GIT_STAT, 'oneline', 'no-patch'],
    longValued: ['format', 'pretty'] },
  log: { flags: 'p0123456789', valued: 'nU',
    long: [...GIT_STAT, 'oneline', 'graph', 'all', 'no-merges', 'merges', 'follow', 'patch',
      'reverse'],
    longValued: ['max-count', 'since', 'until', 'author', 'grep', 'diff-filter', 'format',
      'pretty', 'skip'] },
  status: { flags: 'sb', long: ['short', 'porcelain'] },
  blame: { flags: 'we', valued: 'L' },
  'ls-files': { flags: 'cmod',
    long: ['cached', 'others', 'modified', 'deleted', 'exclude-standard'] },
  'rev-parse': { long: ['show-toplevel', 'abbrev-ref', 'is-inside-work-tree'] },
  grep: { flags: 'nivwFEclLoHhqI', valued: 'eABC' },
};
// The primaries of find that a reviewer's shell allows: with no value, with a text value, and
// with a number, which may start with - or +.
const FIND_PLAIN = new Set(['print', 'print0', 'prune', 'empty', 'not', 'o', 'a']);
const FIND_TEXT = new Set(['name', 'iname', 'path', 'ipath', 'type', 'maxdepth', 'mindepth',
  'newer', 'regex']);
const FIND_NUMBER = new Set(['size', 'mtime', 'mmin']);
// The files that diff does not read in a reviewer's shell: BSD diff copies a device or system
// file to a temporary file without a limit. The compare ignores case, as macOS reads a path.
const REVIEW_DEVICES = /^\/(?:dev|proc|sys)(?:\/|$)/i;

// reviewDiffPath returns true when diff would open a device, a pipe, / or a path under
// /dev, /proc or /sys. text is the operand as typed; joinedPath is the operand for walkPath,
// which applies a .. part to the real path of the folder before it.
function reviewDiffPath(text, joinedPath) {
  const target = real(joinedPath);
  const bad = (full) => REVIEW_DEVICES.test(full) || full === path.parse(full).root;
  if (bad(text) || bad(target)) return true;
  const stat = disk.stat(target);
  if (stat && !stat.isFile() && !stat.isDirectory()) return true;
  const resolved = disk.realpath(target);
  return resolved !== null && bad(resolved);
}

// reviewDiffRefused returns the first of operands, the operands of diff, that diff may not
// read, or undefined. When one of two operands is a folder and the other an existing file,
// diff reads the file of that name in the folder, which is checked too. The file may change
// between this read and the read of diff.
function reviewDiffRefused(folder, operands) {
  const alone = operands.find((one) => reviewDiffPath(path.resolve(folder, one),
    joined(folder, one)));
  if (alone !== undefined || operands.length !== 2) return alone;
  const kind = (one) => disk.stat(real(joined(folder, one)));
  const stats = operands.map(kind);
  for (let at = 0; at < 2; at += 1) {
    const [inside, other] = [stats[at], stats[1 - at]];
    if (!inside || !inside.isDirectory() || !other || other.isDirectory()) continue;
    const sep = operands[at].endsWith(path.sep) ? '' : path.sep;
    const within = `${operands[at]}${sep}${path.basename(operands[1 - at])}`;
    if (reviewDiffPath(path.resolve(folder, within), joined(folder, within))) return within;
  }
  return undefined;
}

// reviewWords splits command into simple commands, each a list of words, as the shell does for
// a command of plain words. Commands are separated by |, ||, &&, ; and line feeds. It returns
// the reason, as text, for a command with anything else: a control character, an open quote,
// more than 20000 characters, a background &, a |&, or outside single quotes a $, a backtick or
// a backslash. Outside quotes it also refuses < > ( ) { } ! #, the characters * ? [ that the
// shell expands to file names (also to names that start with -), a ^ that zsh expands when
// its option extendedglob is set, a word that starts with =, and a ~ at the start of a word
// or after = or :, which the shell expands to a home path.
// For the = and ~ rules, word is the text of the word so far, which an empty quote leaves
// empty.
function reviewWords(command) {
  const text = String(command);
  if (text.length > 20000) return 'a command of more than 20000 characters';
  const commands = [];
  let words = [];
  let word = '';
  let started = false;
  let quote = null;
  const endWord = () => {
    if (started) words.push(word);
    word = '';
    started = false;
  };
  const endCommand = () => {
    endWord();
    if (words.length) commands.push(words);
    words = [];
  };
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at];
    const code = char.charCodeAt(0);
    if ((code < 32 && char !== '\t' && char !== '\n') || code === 127) {
      return 'a control character';
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      else word += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if ('$`\\'.includes(char)) return `the character ${char} in double quotes`;
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === ' ' || char === '\t') {
      endWord();
    } else if (char === '\n' || char === ';') {
      endCommand();
    } else if (char === '|') {
      if (text[at + 1] === '|') at += 1;
      else if (text[at + 1] === '&') return 'the pipe |&';
      endCommand();
    } else if (char === '&') {
      if (text[at + 1] !== '&') return 'a background &';
      at += 1;
      endCommand();
    } else if ('`$<>(){}\\!#*?[^'.includes(char)) {
      return `the character ${char} outside quotes`;
    } else if (char === '~' && (word === '' || /[=:]$/.test(word))) {
      return 'a ~ that starts a word or follows = or : outside quotes';
    } else if (char === '=' && word === '') {
      return 'a word that starts with = outside quotes';
    } else {
      word += char;
      started = true;
    }
  }
  if (quote !== null) return 'an open quote';
  endCommand();
  return commands;
}

// reviewArgs returns the first word of args that the options of allowed, an entry of
// REVIEW_OPTIONS or REVIEW_GIT, do not list, or null. It checks each word that starts with -,
// also after --, and the value of an option.
function reviewArgs(args, allowed) {
  const { flags = '', valued = '', long = [], longValued = [], noPlus = false } = allowed;
  if (noPlus) {
    const plus = args.find((one) => one.startsWith('+'));
    if (plus !== undefined) return plus;
  }
  // The value of an option: the rest of the word, or the next word, which starts with no -.
  const take = (rest, at) => {
    if (rest !== '') return { value: rest, at };
    const value = args[at + 1];
    return value === undefined || value.startsWith('-') ? null : { value, at: at + 1 };
  };
  let ended = false;
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at];
    if (!word.startsWith('-')) continue;
    if (ended || word === '-') return word;
    if (word === '--') {
      ended = true;
    } else if (word.startsWith('--')) {
      const equals = word.indexOf('=');
      const name = word.slice(2, equals < 0 ? word.length : equals);
      if (equals < 0 && long.includes(name)) continue;
      if (!longValued.includes(name)) return word;
      const got = take(equals < 0 ? '' : word.slice(equals + 1), at);
      if (got === null || ((name === 'format' || name === 'pretty') && GIT_GPG.test(got.value))) {
        return word;
      }
      at = got.at;
    } else {
      for (let one = 1; one < word.length; one += 1) {
        if (flags.includes(word[one])) continue;
        if (!valued.includes(word[one])) return word;
        const got = take(word.slice(one + 1), at);
        if (got === null) return word;
        at = got.at;
        break;
      }
    }
  }
  return null;
}

// reviewFind returns the first word of args, the words after find, that is no primary of
// FIND_PLAIN, FIND_TEXT or FIND_NUMBER or has no value of its kind, or null.
function reviewFind(args) {
  for (let at = 0; at < args.length; at += 1) {
    const word = args[at];
    if (!word.startsWith('-')) continue;
    const primary = word.slice(1);
    if (FIND_PLAIN.has(primary)) continue;
    const next = args[at + 1];
    if (next === undefined) return word;
    if (FIND_NUMBER.has(primary) && /^[-+]?[0-9]+[ckMGbw]?$/.test(next)) at += 1;
    else if (FIND_TEXT.has(primary) && !next.startsWith('-')) at += 1;
    else return word;
  }
  return null;
}

// reviewHasGit reports whether folder, or a folder above it, has a .git folder or file. It
// runs no git.
function reviewHasGit(folder) {
  let at = path.resolve(folder);
  for (let depth = 0; depth < 256; depth += 1) {
    const stat = disk.lstat(path.join(at, '.git'));
    if (stat && (stat.isDirectory() || stat.isFile())) return true;
    const up = path.dirname(at);
    if (up === at) return false;
    at = up;
  }
  return false;
}

// reviewShell returns null when command only reads, and else what it refuses, as text. Each
// command is one of REVIEW_OPTIONS, find, or git when git is true, with the listed options.
// An empty command runs nothing and is allowed. folder is the working folder.
function reviewShell(command, git, folder) {
  const commands = reviewWords(command);
  if (typeof commands === 'string') return commands;
  for (const [name, ...args] of commands) {
    let refused = null;
    if (name === 'git') {
      if (!git) return `the command ${reviewShown(name)}`;
      if (!Object.hasOwn(REVIEW_GIT, args[0])) {
        return args.length ? `the git subcommand ${reviewShown(args[0])}`
          : 'git with no subcommand';
      }
      refused = reviewArgs(args.slice(1), REVIEW_GIT[args[0]]);
      if (refused !== null) return `the option ${reviewShown(refused)} of git ${args[0]}`;
    } else if (name === 'find') {
      refused = reviewFind(args);
      if (refused !== null) return `the word ${reviewShown(refused)} of find`;
    } else if (!Object.hasOwn(REVIEW_OPTIONS, name)) {
      return `the command ${reviewShown(name)}`;
    } else {
      refused = reviewArgs(args, REVIEW_OPTIONS[name]);
      if (refused !== null) return `the option ${reviewShown(refused)} of ${name}`;
      const device = name === 'diff'
        ? reviewDiffRefused(folder, args.filter((one) => !one.startsWith('-'))) : undefined;
      if (device !== undefined) return `the file ${reviewShown(device)} of diff`;
    }
  }
  return null;
}

// reviewShellDeny returns the deny for a shell command with the refusal that reviewShell
// returned. Its fixed text contains git only when the working folder has git.
const reviewShellDeny = (git, refused, hook) => 'Run only read commands: cat, head, tail, ls, ' +
  `wc, grep, rg, find, ${git ? 'git diff, git log, git show.' : 'sort, cut, diff.'}\n` +
  `Refused: ${refused}.\n` +
  `A ${hook ? 'hook' : 'reviewer'} session writes only its report file, so each other ` +
  'command is denied, and so ' +
  'is an option that the command does not list, a redirect, $( ), a backtick, a variable and ' +
  'a * ? [ ^ outside quotes, and a ~ that starts a word or follows = or : outside quotes. The ' +
  'commands are cat, head, tail, ' +
  `ls, wc, grep, rg, find, sort, cut, diff and pwd${git ? ', and git diff, show, log, ' +
  'status, blame, ls-files, rev-parse and grep' : ''}. For unique lines use sort -u.`;

// reviewDeny returns the deny of a write from a reviewer, or null for the one write that the
// main session of a reviewer may make: a Write, with one path, or an apply_patch of the form
// of reportPatch, to qory.review.report of reviewReport. An agent never may. The path
// is read through the links of the folders above it; a link, a folder or a file with more than
// one link at the path, a path below .git or .claude of the working folder, and a path that the
// guard cannot read through are no report path. On a disk that ignores case, the compare
// ignores it too: the folder of the report decides, as caseless reads it, and so does the working
// folder. The deny reasons that come first, the harness home, .qory/build/ and a locked file,
// were returned before this.
function reviewDeny({ call, input, paths, env, root, nocase, agent = false }) {
  const review = reviewReport(env);
  const report = review ? review.report : null;
  // The real path that the call writes, for the one form of call that may write the report: a
  // Write with one path, or an apply_patch of exactly the form that reportPatch reads, of the
  // main session. The path of a patch is the one that reportPatch returns.
  let asked = null;
  if (!agent && call.kind === 'write') {
    if (input.tool_name === 'Write' && paths.length === 1) {
      asked = paths[0];
    } else if (input.tool_name === 'apply_patch') {
      const file = reportPatch((input.tool_input || {}).command);
      const walked = file === null ? null : walkPath(file);
      if (walked && !walked.unsure) asked = walked.real;
    }
  }
  if (report && asked !== null) {
    const stat = disk.lstat(report);
    const named = walkPath(report);
    if ((!stat || (stat.isFile() && stat.nlink === 1)) && !named.unsure) {
      const folded = nocase || caseless(path.dirname(named.real));
      const fold = (full) => (folded ? full.toLowerCase() : full);
      const kept = ['.git', '.claude'].some((name) =>
        under(fold(named.real), fold(path.join(root, name))));
      if (!kept && fold(asked) === fold(named.real)) return null;
    }
  }
  const hook = Boolean(review && review.hook);
  const head = agent ? (hook ? HOOK_AGENT : REVIEW_AGENT)
    : report ? (hook ? HOOK_ONLY : REVIEW_ONLY) : hook ? HOOK_NONE : REVIEW_NONE;
  return `${head}The call writes ${paths.join(', ')}.`;
}

// reviewSession returns { reports } for a review session, or null for any other session. A
// session is a review session when inputs.json, read as reviewReport reads it, has the member
// qory.review_session as an object, no qory.review object and no qory.hook_session: with
// either, the rules of a reviewer session apply. reports is qory.review_session.reports when
// it is a normalised absolute path, as reviewReport reads qory.review.report; otherwise null.
function reviewSession(env) {
  const qory = qoryInputs(env);
  if (!qory || member(qory.review) || Object.hasOwn(qory, HOOK_SESSION) ||
    !member(qory.review_session)) return null;
  const { reports } = qory.review_session;
  return { reports: normalPath(reports) ? reports : null };
}

// The form of the name of a report file of a review session.
const REPORT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
// The prefix of an agent of the harness's Claude Code plugin in agent_type, as step-limit.cjs
// reads it.
const PLUGIN = 'harness:';

// reportName returns the name of the report file of the agent of agentType in a review
// session, on runtime, with home the harness home. On Claude Code the type is harness: and
// the name, as Claude Code sends an agent of the harness's plugin; a bare name can be an agent
// of the working folder. On Codex it is the name of a role that the composed home defines, as
// a regular file <home>/codex/agents/<name>.toml, where qory writes each role. It returns null
// for any other type or runtime, for a name that does not match REPORT_NAME, and for
// full-suite, a name that qory reserves for an entry that it writes.
function reportName(agentType, runtime, home) {
  if (typeof agentType !== 'string') return null;
  let name = null;
  if (runtime === 'claude' && agentType.startsWith(PLUGIN)) {
    name = agentType.slice(PLUGIN.length);
  } else if (runtime === 'codex' && typeof home === 'string' && path.isAbsolute(home)) {
    name = agentType;
  }
  if (name === null || !REPORT_NAME.test(name) || name === 'full-suite') return null;
  if (runtime === 'claude') return name;
  const role = disk.stat(path.join(home, 'codex', 'agents', `${name}.toml`));
  return role && role.isFile() ? name : null;
}

// keptFiles returns the entries that no call writes, except as decideCall allows: in a session
// with qory.review or qory.review_session, the file inputs.json of the harness home, wherever
// the home lies, and the home itself when it lies outside root, the working folder; in a
// review session, the report folder, read through its links, and verification.json and
// .reports/matrix-record.json of the artifact folder, which only checks.cjs matrix writes; and
// in every session, .step-reports of the artifact folder.
// Each entry is { full, folder, inputs, nocase, head, except }, with head the first two lines
// of its deny; matrix is true for the two files of the artifact folder; inputs is true
// for an entry of the home, whose deny comes before the rule of a reviewer's report. except
// is the path that the entry of the home leaves to the rules of a review: the report of
// reviewReport, or the report folder of a review session, with every path below it.
function keptFiles(env, session, nocase, root, artifacts) {
  const out = [];
  const qory = qoryInputs(env);
  const reviewer = reviewReport(env);
  const home = env.QORY_HARNESS_HOME;
  if (qory && (reviewer || member(qory.review_session)) &&
    typeof home === 'string' && path.isAbsolute(home)) {
    const full = real(path.join(home, 'inputs.json'));
    out.push({ full, folder: false, inputs: true, head: INPUTS_KEPT,
      nocase: nocase || caseless(path.dirname(full)) });
    const top = real(home);
    const fold = (one) => (nocase ? one.toLowerCase() : one);
    if (!under(fold(top), fold(root))) {
      const left = reviewer ? reviewer.report : session && session.reports;
      out.push({ full: top, folder: true, inputs: true, home: true, head: HOME_KEPT,
        nocase: nocase || caseless(top) || caseless(path.dirname(top)),
        except: [...(left ? [real(left)] : []), root], shell: homeParts(top, root, fold) });
    }
  }
  if (session && session.reports) {
    const full = real(session.reports);
    out.push({ full, folder: true, inputs: false, head: REPORTS_KEPT,
      nocase: nocase || caseless(full) || caseless(path.dirname(full)) });
  }
  // The reports of STEP_REVIEWERS: a shell command that writes there, by a link, a .. part, or a
  // move or a removal of a folder above, as readShell reads it.
  if (artifacts) {
    const full = path.join(artifacts, STEP_REPORTS);
    out.push({ full, folder: true, inputs: false, step: true, head: STEP_KEPT,
      nocase: nocase || caseless(artifacts) || caseless(path.dirname(artifacts)) });
  }
  // shortcut: the guard reads the text of a call, so the checks script run by another script,
  // or a path that code joins from parts, passes; a verification.json that the main session
  // writes in a call whose text has no such path is out of its reach. Replace it with a
  // check at the push if qory ever runs that check where the record is.
  if (session && artifacts) {
    for (const file of [path.join(artifacts, MATRIX_FILE), path.join(artifacts, MATRIX_RECORD)]) {
      const full = real(file);
      out.push({ full, folder: false, inputs: false, matrix: true, head: MATRIX_KEPT,
        nocase: nocase || caseless(path.dirname(full)) });
    }
    // The version store: a file below <artifacts>/<type>/, which only qory pulls writes.
    const store = real(artifacts);
    out.push({ full: store, folder: true, deep: true, inputs: false, head: STORE_KEPT,
      nocase: nocase || caseless(store), except: session.reports ? [real(session.reports)] : [] });
  }
  return out;
}

// homeParts returns the entries that a shell command must not write for the harness home top:
// top itself, or, when root, the working folder, lies below top, each entry of each folder
// from top down to root that is not on the way to root, so that root keeps its rules.
// shortcut: a new name directly in such a folder, such as <home>/x, is not in the list, so a
// shell write of it passes, while Write and Edit are denied; list names when this matters.
function homeParts(top, root, fold) {
  if (!under(fold(root), fold(top))) return [top];
  const out = [];
  const steps = path.relative(top, root).split(path.sep);
  let dir = top;
  for (const step of steps) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) if (fold(name) !== fold(step)) out.push(path.join(dir, name));
    dir = path.join(dir, step);
  }
  return out;
}

// INTERPRETERS run the file of their first word that is no option, as in node <file>.
const INTERPRETERS = /^(?:node|python3?|ruby|perl|deno|bun|sh|bash|zsh|dash)$/;

// withoutScript returns segment without the file that it runs, when inHome passes for that
// file, so that node <home>/x.cjs does not reach the home by the file that it runs; else
// segment. The caller passes only a segment of a call with no quotes or parentheses.
function withoutScript(segment, inHome, realOf) {
  const words = plainWords(segment.words);
  const at = INTERPRETERS.test(path.basename(words[0] || '')) ? 1 : 0;
  const file = words[at];
  if (!file || file.startsWith('-')) return segment;
  if (!segment.cwds.every((cwd) => inHome(realOf(joined(cwd, file))))) return segment;
  const rest = segment.words.filter((_, index) => index !== at);
  return { ...segment, words: rest, text: rest.join(' ') };
}

// PUSH_FORM is the one push of an artifact that a review session runs: <qory> artifact push
// with at most one --name and one --note, before the type or after the path, a type, and the
// full path of the file. Anything
// else, such as -- or a root flag of qory, a variable or a quote in the path, does not match.
const PUSH_OPTION = '(?:\\s+--name(?:=|\\s+)[\\w.-]+|\\s+--note(?:=|\\s+)' +
  '(?:"[^"$`\\\\]*"|\'[^\']*\'|[\\w.-]+)){0,2}';
const PUSH_FORM = new RegExp(`^\\s*(?:/[\\w./-]*/)?qory artifact push${PUSH_OPTION}\\s+` +
  '([a-z0-9-]+)\\s+(/[^\\s\'"$`\\\\;&|<>()*?[\\]{}~]+)' + `${PUSH_OPTION}\\s*$`);

// pushedFrom returns the type and the real path of the push that command is, as PUSH_FORM
// reads it, or null.
function pushedFrom(command) {
  const found = PUSH_FORM.exec(String(command));
  return found ? { type: found[1], file: real(found[2]) } : null;
}

// pushDeny returns the reason to deny command, a call of a review session that is no read,
// when it has the word push and the word verification or a variable or a command
// substitution, and is not the push that PUSH_FORM allows: for verification, from
// verification.json of artifacts; for another type, from a file below artifacts. Else null.
// shortcut: a push that another program makes passes; the push check of qory is the control.
function pushDeny(command, artifacts, nocase, words) {
  const text = String(command);
  const fold = (one) => (nocase ? one.toLowerCase() : one);
  const pushes = /(?:^|[^\w-])push(?:[^\w-]|$)/.test(text) || words.includes('push');
  const named = /verification/i.test(text) || words.some((one) => /verification/i.test(one));
  if (!pushes || !(named || /[$`]/.test(text))) return null;
  const form = pushedFrom(command);
  const ok = form && (form.type === 'verification'
    ? fold(form.file) === fold(real(path.join(artifacts, MATRIX_FILE)))
    : under(fold(form.file), fold(artifacts)));
  return ok ? null : `${PUSH_KEPT}The command is ${reviewShown(command)}.`;
}

// artifactNamed returns the first word of the segments of command that names artifacts, the
// artifact folder, .reports in it, or a folder above them, or a path inside it, from the
// folder of its segment, or contains the path of artifacts; and a call that runs in artifacts.
function artifactNamed(segs, artifacts, nocase) {
  const fold = (one) => (nocase ? one.toLowerCase() : one);
  const folder = fold(artifacts);
  for (const segment of segs) {
    const inside = segment.cwds.find((from) => under(fold(real(from)), folder));
    if (inside) return inside;
    const words = plainWords(segment.words);
    for (const [index, word] of words.entries()) {
      if (fold(word).includes(folder)) return word;
      // A folder above artifacts counts only where a program takes a folder to work in or to
      // write to: after cd, pushd, -C, -d, -o or --directory, also as -C<path>.
      const attached = /^(?:-[Cdo]|--directory=)(?=.)/.test(word);
      const last = index === words.length - 1;
      // ditto and python3 -m zipfile -e take the folder to write to as the last word.
      const unpacks = path.basename(words[0]) === 'ditto' ||
        (words.includes('zipfile') && (words.includes('-e') || words.includes('--extract')));
      const target = attached || (last && unpacks) ||
        /^(?:cd|pushd|-C|-d|-o|--directory)$/.test(words[index - 1] || '');
      // A path that follows an option, as in -C<folder>, -o<folder> or --directory=<folder>.
      const slash = word.indexOf('/');
      for (const part of new Set([word, slash >= 0 ? word.slice(slash) : ''])) {
        if (part === '' || vague(part)) continue;
        for (const from of segment.cwds) {
          const at = fold(real(joined(from, literal(part))));
          if (under(at, folder) || (target && under(folder, at))) return word;
        }
      }
    }
  }
  return null;
}

// VERSION_FILE matches a path below the artifact folder that lies in a stored version, as
// versions.cjs reads it: <type>/<name>/v<N>/<file>, or deeper, with a type of [a-z-]+ as its
// TYPE. .notes/ and .reports/ start with a dot and are no type.
const VERSION_FILE = /^[a-z-]+[/\\][^/\\]+[/\\]v[0-9]+[/\\][^/\\]/;

// keptWrite returns { inputs, reason } for the first of paths, real paths that a call writes,
// that is an entry of kept or lies in a kept folder, or null.
function keptWrite(kept, paths) {
  for (const one of kept) {
    const fold = (full) => (one.nocase ? full.toLowerCase() : full);
    const hit = paths.find((full) => (one.folder ? under(fold(full), fold(one.full))
      : fold(full) === fold(one.full)) &&
      (!one.deep || VERSION_FILE.test(path.relative(fold(one.full), fold(full)))) &&
      !(one.except || []).some((left) => under(fold(full), fold(left))));
    if (hit) return { inputs: one.inputs, reason: `${one.head}The call writes ${hit}.` };
  }
  return null;
}

// checksVerb returns the words after the file of the checks script in command, or null when
// command runs more than the checks script.
function checksVerb(command, env, script) {
  const text = String(command);
  if (!reportsGuard.runsChecks(text, env, script)) return null;
  const words = reportsGuard.withoutRedirect(text).split(/\s+/);
  return words.slice(words[0] === 'node' ? 2 : 1);
}

// sessionExempt reports whether command may contain a path in the report folder of a review
// session although the guard does not read what it writes: the checks script alone with
// findings round, which reads the reports and writes no file.
function sessionExempt(command, env, script) {
  const words = checksVerb(command, env, script);
  return Boolean(words) && words[0] === 'findings' && words[1] === 'round';
}

// The verbs of the checks script that workflow-review-changes and running-a-workflow run in a
// review session. None of them writes a file that a word of the call names. The other verbs
// of workflow-verify-a-ticket (matrix, files, check, notes, starts) are not listed: they pass when
// the call has no path of the home.
const REVIEW_VERBS = [['resume'], ['lock', '--verify'], ['panel'], ['findings', 'round'],
  ['check', 'points'], ['run', 'locked']];

// The verbs of the checks script that a review session may run with the artifact folder in the
// call, beside REVIEW_VERBS: they read it, or write it as only the checks script does.
const ARTIFACT_VERBS = [...REVIEW_VERBS, ['check'], ['matrix'], ['files'], ['notes'], ['starts']];

// comparesVersions reports whether command is versions.cjs alone with compare, which writes no
// file.
function comparesVersions(command, env, script) {
  if (!reportsGuard.runsChecks(command, env, script, 'versions.cjs')) return false;
  const rest = reportsGuard.withoutRedirect(String(command)).split(/\s+/);
  return rest[rest[0] === 'node' ? 2 : 1] === 'compare';
}

// artifactVerb reports whether command is the checks script alone with a verb of
// ARTIFACT_VERBS, or versions.cjs alone with compare, which read the artifact folder.
function artifactVerb(command, env, script) {
  const words = checksVerb(command, env, script);
  if (!words) return comparesVersions(command, env, script);
  return ARTIFACT_VERBS.some((verb) => verb.every((word, at) => words[at] === word));
}

// reviewChecks reports whether command runs the checks script alone with a verb of
// REVIEW_VERBS, which may contain a path of the harness home.
function reviewChecks(command, env, script) {
  const words = checksVerb(command, env, script);
  return Boolean(words) && REVIEW_VERBS.some((verb) => verb.every((word, at) =>
    words[at] === word));
}

const SESSION_NONE = 'Report in your text and write no file: qory.review_session.reports ' +
  'cannot be used.\nIt must be an absolute path with no . or .. part, no double or trailing ' +
  'slash. ';
const SESSION_NAME = 'Report in your text and write no file: the name of this agent is no ' +
  'report name.\nOn Claude Code the type must be harness:<name>, and on Codex a role in ' +
  'codex/agents/ of the harness home; the name must match ' +
  `${REPORT_NAME.source} and must not be full-suite. `;
const SESSION_SHELL = 'Run only read commands, such as cat, grep or ls: a reviewer writes its ' +
  'report with Write.\nIn a review session, a reviewer agent writes only ' +
  '<reports>/<agent name>.json, with Write or apply_patch, so each other command is denied. ';
const REPORTS_KEPT = 'Leave the report folder to the reviewers.\n' +
  'Only the reviewer of that name writes <reports>/<agent name>.json in it. ';
// The draft of Verify and the record under it, which only the verb matrix of checks.cjs writes.
const MATRIX_FILE = 'verification.json';
const MATRIX_RECORD = path.join('.reports', 'matrix-record.json');
const MATRIX_KEPT = 'Leave verification.json and .reports/matrix-record.json of the artifact ' +
  'folder to checks.cjs matrix.\nIn a review session only the verb matrix writes them. ';
const ARTIFACTS_KEPT = 'Leave the artifact folder to the file tools and the checks script.\n' +
  'In a review session a shell command names neither the artifact folder, .reports nor a ' +
  'folder above them, except checks.cjs with a verb of the session and the push of an ' +
  'artifact by its full path. ';
const PUSH_KEPT = 'Push verification only from verification.json of the artifact folder, with ' +
  'its path written out.\nIn a review session a push of that type from another file or from ' +
  'standard input is denied. ';
const VERSIONS_KEPT = 'Run versions.cjs only with compare.\nIn a review session versions.cjs ' +
  'copy is denied: it writes a stored version over verification.json. ';
const STORE_KEPT = 'Leave the version store of the artifact folder to qory.\nIn a review session ' +
  'no call writes below <artifact folder>/<type>/: a pull writes it. ';
const INPUTS_KEPT = 'Leave inputs.json of the harness home as it is: qory wrote the values ' +
  `of the run in it.\nA session with qory.review, qory.review_session or ${HOOK} in ` +
  'it writes no inputs.json. ';
const HOME_KEPT = 'Leave the harness home as it is: a review runs with the guards and agents ' +
  `of it.\nA session with qory.review, qory.review_session or ${HOOK} writes ` +
  'nothing below QORY_HARNESS_HOME when the home lies outside the working folder. ';
const SESSION_ONLY = 'Write only <report folder>/<agent name>.json, with Write or apply_patch: ' +
  'a reviewer writes one file.\nThe report folder is qory.review_session.reports of inputs.json; ' +
  'a path with a .. part, a link, a file with more than one link, a linked report folder and ' +
  'a report folder inside the working folder are denied. ';

// sessionDeny returns the deny of a write of an agent whose type ends in -reviewer in a review
// session, or null for its report, as sessionReport reads it. paths are the real paths of the
// call, and the deny reasons that come first were returned before this.
function sessionDeny({ call, input, paths, root, cwd, nocase, session, runtime, env }) {
  const writes = `The call writes ${paths.join(', ')}.`;
  if (session.reports === null) return `${SESSION_NONE}${writes}`;
  const name = reportName(input.agent_type, runtime, env.QORY_HARNESS_HOME);
  if (name === null) {
    return `${SESSION_NAME}This agent is ${reviewShown(input.agent_type)}. ${writes}`;
  }
  const report = path.join(session.reports, `${name}.json`);
  if (sessionReport({ call, input, cwd, reports: session.reports, name, root, nocase })) {
    return null;
  }
  return `${SESSION_ONLY}The report of this agent is ${report}. ${writes}`;
}

// reportPath returns the path that call writes, in the two forms that write a report: a Write
// with one path, or an apply_patch of the form of reportPatch. It returns null for any other
// call and for a path with a .. part.
function reportPath(call, input, cwd) {
  let given = null;
  if (call.kind === 'write' && input.tool_name === 'Write' && call.paths.length === 1) {
    given = joined(cwd, call.paths[0]);
  } else if (call.kind === 'write' && input.tool_name === 'apply_patch') {
    given = reportPatch((input.tool_input || {}).command);
  }
  return given === null || given.split(path.sep).includes('..') ? null : given;
}

// The folder of the reports of STEP_REVIEWERS in the artifact folder, and that folder in a path
// or a command, with the u flag for U+017F (long s), as in reports-guard.cjs. The name of a
// report is the SHA-256 of what the agent reviewed.
const STEP_REPORTS = '.step-reports';
const STEP_FOLDER = /(?<![\w.-])\.step-reports(?![\w.-])/iu;
const STEP_REPORT = /^[0-9a-f]{64}\.json$/;
const STEP_KEPT = 'Leave .step-reports/ to check-reviewer and plan-reviewer.\nEach of them ' +
  'writes only its report there, with Write or with an apply_patch that adds it. ';
const STEP_ONLY = 'Write only .step-reports/<agent name>/<sha256>.json in the artifact folder, ' +
  'with Write.\nThis reviewer writes one file, its report, with Write or with an apply_patch ' +
  'that adds it; <sha256> is the SHA-256 of the reviewed file. ';

// stepReport reports whether call is the write of a report by an agent of STEP_REVIEWERS: to
// <artifacts>/.step-reports/<name>/<sha256>.json, through no link, where the file, when it exists,
// is a regular file with one link.
function stepReport({ call, input, env, runtime, start, runFolder }) {
  if (typeof input.agent_id !== 'string' || input.agent_id === '') return false;
  const name = reportName(input.agent_type, runtime, env.QORY_HARNESS_HOME);
  if (!steps.STEP_REVIEWERS.has(name) || typeof start !== 'string' || start === '') return false;
  const cwd = real(typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd());
  const given = reportPath(call, input, cwd);
  const artifacts = artifactFolder(real(start), env, runFolder);
  if (given === null || !artifacts || !STEP_REPORT.test(path.basename(given))) return false;
  const above = walkPath(path.dirname(given));
  if (above.unsure || above.real !== path.join(artifacts, STEP_REPORTS, name)) return false;
  const stat = disk.lstat(path.join(above.real, path.basename(given)));
  return !stat || (stat.isFile() && stat.nlink === 1);
}

// sessionReport reports whether call writes exactly <reports>/<name>.json: a Write with one
// path, or an apply_patch of the form of reportPatch. The path in the call has no ..
// part; the folders above its last part are read through their links, as walkPath reads
// them, and must lead to the real report folder. The report folder is no link and, when it
// exists, a folder outside root, the working folder, and the file, when it exists, is a regular
// file with one link. On a disk that ignores case, the compare ignores it too, as in reviewDeny.
function sessionReport({ call, input, cwd, reports, name, root, nocase }) {
  const given = reportPath(call, input, cwd);
  if (given === null) return false;
  const top = disk.lstat(reports);
  if (top && !top.isDirectory()) return false;
  const base = walkPath(reports);
  const above = walkPath(path.dirname(given));
  if (base.unsure || above.unsure) return false;
  const folded = nocase || caseless(base.real);
  const fold = (full) => (folded ? full.toLowerCase() : full);
  if (under(fold(base.real), fold(root))) return false;
  const target = path.join(base.real, `${name}.json`);
  if (fold(path.join(above.real, path.basename(given))) !== fold(target)) return false;
  const stat = disk.lstat(target);
  return !stat || (stat.isFile() && stat.nlink === 1);
}

// artifactFolder returns the artifact folder of the run, as end-gate.cjs finds it from root and
// env, with the folders above it read through their links, or null when the folder itself is
// a link: an agent that replaces the folder with a link to / would make every write a write
// in the artifact folder.
function artifactFolder(root, env, runFolder) {
  const dir = folder(root, env, runFolder);
  try {
    if (fs.lstatSync(dir).isSymbolicLink()) return null;
  } catch {
    // A folder that does not exist yet is no link.
  }
  return path.join(real(path.dirname(dir)), path.basename(dir));
}

// readHookInput returns the hook's input from the text of stdin, or null when it is not a JSON
// object.
function readHookInput(text) {
  try {
    const data = JSON.parse(text);
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// deny returns the JSON that Claude Code and Codex read from a PreToolUse hook on stdout to
// deny a call: the reason goes to the model as the tool's error.
const deny = (reason) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse',
  permissionDecision: 'deny', permissionDecisionReason: reason } });

// run reads the hook's input and acts on its event. On PreToolUse it decides and prints the
// deny, or nothing to let the call run: first the step limit of step-limit.cjs, then before,
// a check that the caller may pass, then decide. On Codex, it also appends the call to the
// calls of the step. On PostToolBatch, the end of a Claude Code step, and PreModelRequest,
// the start of a Codex step, it sets the count of the agent and prints nothing. A guard
// that throws on PreToolUse denies the call with the error, so a fault never opens the
// lock. In a run, input that is not JSON denies the call too.
function run({ runtime, before } = {}) {
  const env = process.env;
  const stdin = reportsGuard.readStdin(env);
  if (stdin.reason) {
    process.stdout.write(`${JSON.stringify(deny(stdin.reason))}\n`);
    process.exitCode = 0;
    return;
  }
  const input = readHookInput(stdin.text);
  if (input === null) {
    if (env.QORY_RUN_ID) process.stdout.write(`${JSON.stringify(deny(NOT_JSON))}\n`);
    process.exitCode = 0;
    return;
  }
  const script = process.argv[1];
  const args = { input, env, runtime, root: steps.rootOf(runtime, env) };
  const stepEnd = input.hook_event_name === 'PostToolBatch' ||
    input.hook_event_name === 'PreModelRequest';
  if (!args.root) {
    // With no working folder, a run denies each call, and a step end counts nothing.
    if (env.QORY_RUN_ID && !stepEnd) process.stdout.write(`${JSON.stringify(deny(NO_ROOT))}\n`);
    process.exitCode = 0;
    return;
  }
  if (stepEnd) {
    const fault = (error) => process.stderr.write(`${CRASHED}${error && error.stack ? error.stack
      : String(error)}\n`);
    // An error while the step's calls are read still counts the step, as one that wrote
    // nothing. PostToolBatch saves that count before it reads the calls, and sets it to 0
    // after a write: a hook process that ends while it reads them, as when it runs out of
    // memory, which no catch reads, leaves the step counted.
    let wrote = false;
    let calls = [];
    const end = (fn) => {
      try {
        fn();
      } catch (error) {
        fault(error);
      }
    };
    if (input.hook_event_name === 'PostToolBatch') {
      end(() => steps.endStep(args, false));
      end(() => {
        const place = placeOf(input, args.root, env);
        const batch = Array.isArray(input.tool_calls) ? input.tool_calls : [];
        const denied = steps.takeDenied(args);
        wrote = batch.some((one) => one !== null && typeof one === 'object' &&
          !denied.has(one.tool_use_id) && countsAsWrite(one.tool_name, one.tool_input, place));
      });
      if (wrote) end(() => steps.endStep(args, true));
    } else {
      // On Codex, a PreToolUse that ends before it appends its line leaves the step with no
      // line, which stepWithoutCalls counts as a step that wrote nothing.
      end(() => {
        calls = steps.takeCalls(args);
        wrote = Boolean(calls) && calls.some((one) => one && one.write === true);
      });
      end(() => (calls === null ? steps.stepWithoutCalls(args) : steps.endStep(args, wrote)));
    }
    process.exitCode = 0;
    return;
  }
  let reason;
  try {
    const deadline = Date.now() + TIME_LIMIT;
    const write = countsAsWrite(input.tool_name, input.tool_input,
      placeOf(input, args.root, env), deadline);
    reason = steps.limited(args, write) || (before && before(input)) ||
      decide({ input, env, script, root: args.root, deadline, runtime });
    // A denied call wrote nothing: on Codex its line has write false, and on Claude Code
    // PostToolBatch counts no write of a call whose id is in the denied file. A count
    // folder that cannot be written keeps the reason: limited reads that folder.
    try {
      if (runtime === 'codex') steps.appendCall(args, write && !reason);
      if (runtime === 'claude' && reason) steps.appendDenied(args, input.tool_use_id);
    } catch (error) {
      if (!steps.limited(args, false)) throw error;
    }
  } catch (error) {
    reason = `${CRASHED}${error && error.stack ? error.stack : String(error)}`;
  }
  if (reason) process.stdout.write(`${JSON.stringify(deny(reason))}\n`);
  process.exitCode = 0;
}

// The fixed texts that start a deny, for the check of their first lines.
const REASONS = { BACKGROUND, BUILT, MAIN, CRASHED, HOMED, MODED, LINKED, NO_ROOT, TOO_MUCH,
  OPAQUE, LOST, LINK_MADE, UNSURE, NOT_JSON, SESSION_NONE, SESSION_NAME, SESSION_SHELL,
  SESSION_ONLY, REPORTS_KEPT, INPUTS_KEPT, HOME_KEPT, STEP_KEPT, STEP_ONLY };

module.exports = { decide, lockedFiles, patchPaths, countsAsWrite, deny, run, reportName,
  REASONS };
