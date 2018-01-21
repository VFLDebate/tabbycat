var gulp = require('gulp');
var gutil = require('gulp-util'); // Error logging + NoOop

// Compilation
var sass = require('gulp-sass');
var rename = require('gulp-rename');
var concat = require('gulp-concat');
var envify = require('envify');

// Compression
var cleanCSS = require('gulp-clean-css');
var uglify = require('gulp-uglify');

// Browserify
var browserify = require('browserify'); // Bundling modules
var watchify = require('watchify'); // Incremental Browserify
var babelify = require('babelify'); // Use ES syntax
var vueify = require('vueify');
var source = require('vinyl-source-stream'); // Use browserify in gulp
var es = require('event-stream'); // Browserify multiple files at once
var streamify = require('gulp-streamify');

// Debug & Config
var livereload = require('gulp-livereload');
var outputDir = 'tabbycat/static/';
var isProduction = (gutil.env.production === true) ? true : false;
if (isProduction === true) {
  console.log('GULP: Building for production');
} else if (isProduction === false) {
  console.log('GULP: Building for development');
}

// Browserify bundle sequence
function bundle(entry, incremental) {

  // If build-ing just use browserify
  var bundleFunction = browserify({
    noparse: ['jquery', 'lodash'], // Skip big libs
    fast: false, // Skip detecting/inserting global vars
  });
  // If watch-ing wrap with watchify
  if (incremental === true) {
    bundleFunction = watchify(bundleFunction);
  }

  return bundleFunction
    .add(entry)
    .on('update', function() {
      if (incremental === true) {
        bundle(entry, true);
        console.log('[        ] Finished rebundling via watchify');
      }
    })
    .transform(vueify).on('error', gutil.log)
    .transform([babelify, {
      presets: ["es2015"],
      plugins: ['transform-runtime']
    }]).on('error', gutil.log)
    .transform(envify, {
      // Read from the gulp --production flag to determine whether Vue
      // should be in development mode or not
      global: true,
      _: 'purge',
    }).on('error', gutil.log)
    .bundle().on('error', gutil.log)
      .on('error', function() {
        gutil.log
        this.emit('end');
      })
    .pipe(source(entry))
      .on('error', gutil.log)
    .pipe(isProduction ? streamify(uglify()) : gutil.noop())
      .on('error', gutil.log)
    .pipe(rename({
        extname: '.bundle.js',
        dirname: ''
    }))
    .pipe(gulp.dest(outputDir + '/js/'));
}

// Tasks
gulp.task('fonts-compile', function() {
  gulp.src([
      'node_modules/inter-ui/Inter UI (web)/*.woff',
      'node_modules/inter-ui/Inter UI (web)/*.woff2',
    ])
    .pipe(gulp.dest(outputDir + 'fonts/'));
});

gulp.task('styles-compile', function() {
  gulp.src([
      'tabbycat/templates/scss/allocation-old.scss',
      'tabbycat/templates/scss/printables.scss',
      'tabbycat/templates/scss/style.scss'])
    .pipe(sass().on('error', sass.logError))
    // '*' compatability = IE9+
    .pipe(isProduction ? cleanCSS({compatibility: '*'}) : gutil.noop())
    .pipe(gulp.dest(outputDir + '/css/'))
    .pipe(isProduction ? gutil.noop() : livereload());
});

gulp.task("js-compile", function() {
  // Vendors
  gulp.src([
    'node_modules/jquery/dist/jquery.js', // For Debug Toolbar
    'node_modules/jquery-validation/dist/jquery.validate.js', // Deprecate,
    ])
    .pipe(isProduction ? uglify() : gutil.noop()) // Doesnt crash
    .pipe(gulp.dest(outputDir + '/js/vendor/'));

  // Standlones
  gulp.src(['tabbycat/templates/js-standalones/*.js'])
    // Can't run uglify() until django logic is out of standalone js files
    // .pipe(isProduction ? uglify() : gutil.noop())
    .pipe(gulp.dest(outputDir + '/js/'))
    .pipe(isProduction ? gutil.noop() : livereload());
});

// With thanks to https://fettblog.eu/gulp-browserify-multiple-bundles/
// We define our input files, which we want to have bundled and then map them
// to our stream function using files.map()
var files = [
    'tabbycat/templates/js-bundles/public.js',
    'tabbycat/templates/js-bundles/admin.js'
];

gulp.task("js-browserify", function() {
  var tasks = files.map(function(entry) {
    return bundle(entry, false);
  });
  return es.merge.apply(null, tasks);
});

gulp.task("js-watchify", function() {
  var tasks = files.map(function(entry) {
    return bundle(entry, true);
  });
  return es.merge.apply(null, tasks);
});

gulp.task("html-reload", function() {
  return gulp.src('').pipe(livereload());
});

// Runs with --production if debug is false or there's no local settings
gulp.task('build', [
  'fonts-compile', 'styles-compile', 'js-compile', 'js-browserify'
 ]);

// Runs when debug is True and when runserver/collectstatic is called
// Watch the CSS/JS for changes and copy over to static AND static files when done
gulp.task('watch', [
    'fonts-compile', 'styles-compile', 'js-compile', 'js-watchify'
  ], function() {
    livereload.listen();
    gulp.watch('tabbycat/templates/scss/**/*.scss', ['styles-compile']);
    gulp.watch('tabbycat/templates/js-standalones/*.js', ['js-compile']);
    gulp.watch('tabbycat/**/*.html', ['html-reload']);
  }
);
