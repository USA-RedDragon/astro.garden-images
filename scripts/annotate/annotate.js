// ----------------------------------------------------------------------------
// astro.garden overlay runner (PJSR)
//
// Plate-solves an image if needed, then renders the gallery SVG overlay with
// the style in style.json and the layer rules in README.md.
//
// GUI:      Script > Execute Script File... > this file (acts on the active
//           image, asks for the SVG path).
// Headless: python3 bundle.py ... builds a single-file bundle (no #include)
//           and prints the run_script call for the PixInsight MCP bridge.
//
// Nothing is read from or written to PixInsight's Settings: the stock
// ImageSolver / AnnotateImage engines are constructed with defaults and every
// parameter is then set from style.json. Image files are never written.
// ----------------------------------------------------------------------------

#engine v8

#define USE_SOLVER_LIBRARY true
#define SETTINGS_MODULE "AstroGardenAnnotate"
#include "/opt/PixInsight/src/scripts/ImageSolver/ImageSolver.js"
#undef VERSION
#undef TITLE

#define USE_ANNOTATE_LIBRARY true
#include "/opt/PixInsight/src/scripts/AnnotateImage/AnnotateImage.js"

var AG_SCRIPT_DIR = File.extractDirectory( #__FILE__ );
var AG_VERSION = "1";

// ----------------------------------------------------------------------------
// Small helpers

function agStrip( o )
{
   // Drop "_comment" keys.
   if ( Array.isArray( o ) )
      return o.map( agStrip );
   if ( o !== null && typeof o == "object" )
   {
      let r = {};
      for ( let k in o )
         if ( k[0] != '_' )
            r[k] = agStrip( o[k] );
      return r;
   }
   return o;
}

function agReadJSON( path )
{
   return agStrip( JSON.parse( File.readTextFile( path ) ) );
}

function agARGB( spec )
{
   let rgb = parseInt( spec.color.replace( '#', '' ), 16 );
   let a = Math.round( ((spec.opacity === undefined) ? 1 : spec.opacity)*255 );
   return a*0x1000000 + rgb;
}

function agDateToJD( s )
{
   // "YYYY-MM-DD" or ISO date-time -> JD
   if ( s.length == 10 )
      s += "T00:00:00";
   return Math.calendarTimeToJD( s );
}

function agGalacticLatitude( raDeg, decDeg )
{
   let d2r = Math.PI/180;
   let aG = 192.85948*d2r, dG = 27.12825*d2r;
   let a = raDeg*d2r, d = decDeg*d2r;
   let sb = Math.sin( d )*Math.sin( dG ) + Math.cos( d )*Math.cos( dG )*Math.cos( a - aG );
   return Math.asin( sb )/d2r;
}

function agUniqueId( base )
{
   let id = base.replace( /[^A-Za-z0-9_]/g, '_' );
   if ( !/^[A-Za-z_]/.test( id ) )
      id = '_' + id;
   let cand = id;
   for ( let i = 1; !ImageWindow.windowById( cand ).isNull; ++i )
      cand = id + '_' + i;
   return cand;
}

// Name lookup through CDS Sesame; returns {ra, dec} in degrees or null.
function agSesame( name )
{
   let url = "https://cdsweb.u-strasbg.fr/cgi-bin/nph-sesame/-oI/A?" + encodeURIComponent( name );
   let out = File.uniqueFileName( File.systemTempDirectory, 10, "ag-sesame-", ".txt" );
   let dl = new FileDownload( url, out );
   try
   {
      dl.perform();
      if ( !dl.ok )
         return null;
      let lines = File.readLines( out, ReadTextOption.RemoveEmptyLines | ReadTextOption.TrimSpaces );
      for ( let i = 0; i < lines.length; ++i )
         if ( lines[i].startsWith( "%J " ) )
         {
            let f = lines[i].split( /\s+/ );
            return { ra: parseFloat( f[1] ), dec: parseFloat( f[2] ) };
         }
      return null;
   }
   finally
   {
      if ( File.exists( out ) )
         File.remove( out );
   }
}

// ----------------------------------------------------------------------------
// Plate solving

function agSolve( window, style, seedOpts, report )
{
   let solver = new ImageSolver;   // defaults only; no Settings read

   let cfg = Object.assign( {}, style.solver, seedOpts.solver || {} );
   for ( let k in cfg )
      if ( k == "rbfType" )
         solver.solverCfg.rbfType = (typeof cfg.rbfType == "string") ? RadialBasisFunction[cfg.rbfType] : cfg.rbfType;
      else
         solver.solverCfg[k] = cfg[k];
   solver.solverCfg.useActive = true;
   solver.solverCfg.files = [];

   let md = solver.metadata;
   md.ExtractMetadata( window );   // keywords / existing solution, if any
   md.width = window.mainView.image.width;
   md.height = window.mainView.image.height;

   // Centre: explicit > image metadata > name lookup.
   let src = "image metadata";
   if ( seedOpts.ra !== undefined && seedOpts.dec !== undefined )
   {
      md.ra = seedOpts.ra;
      md.dec = seedOpts.dec;
      src = "explicit ra/dec";
   }
   else if ( md.ra === null || md.dec === null || md.ra === undefined || md.dec === undefined )
   {
      if ( !seedOpts.target )
         throw new Error( "No centre coordinates: the image has no RA/DEC and no 'target', 'ra'/'dec' was given." );
      let p = agSesame( seedOpts.target );
      if ( p === null )
         throw new Error( "Sesame could not resolve target '" + seedOpts.target + "'." );
      md.ra = p.ra;
      md.dec = p.dec;
      src = "Sesame(" + seedOpts.target + ")";
   }

   // Scale: explicit > image metadata > style default.
   // (md.resolution is not used unless the image has a WCS: without one,
   // ExtractMetadata fills it from default focal/pixel size values.)
   let res = seedOpts.resolution;
   let resSrc = "given";
   if ( res === undefined )
   {
      let kw = {};
      for ( let k of window.keywords )
         kw[k.name] = parseFloat( k.strippedValue );
      if ( md.ref_I_G !== null && md.resolution )
      {
         res = md.resolution*3600;
         resSrc = "existing WCS";
      }
      else if ( kw.FOCALLEN > 0 && (kw.XPIXSZ > 0 || kw.PIXSIZE1 > 0) )
      {
         res = 206.264806*(kw.XPIXSZ || kw.PIXSIZE1)*(kw.XBINNING || 1)/kw.FOCALLEN;
         resSrc = "FOCALLEN/XPIXSZ";
      }
      else
      {
         res = style.seeds.resolution;
         resSrc = "style default";
      }
   }
   md.resolution = res/3600;
   md.xpixsz = style.seeds.xpixsz;
   md.useFocal = false;
   md.focal = md.FocalFromResolution( md.resolution );
   md.referenceSystem = style.seeds.referenceSystem;

   // Observation time: explicit > DATE-OBS > fallback.
   let dateSrc = "DATE-OBS";
   if ( seedOpts.date )
   {
      md.observationTime = agDateToJD( seedOpts.date );
      dateSrc = "given " + seedOpts.date;
   }
   else if ( !md.observationTime )
   {
      md.observationTime = agDateToJD( style.seeds.fallbackDate );
      dateSrc = "fallback " + style.seeds.fallbackDate;
   }
   md.ensureValidReferenceSystemForSolution();

   report.solve = { seedRA: md.ra, seedDec: md.dec, seedSource: src, seedResolution: res, resolutionSource: resSrc,
                    observationTimeJD: md.observationTime, dateSource: dateSrc };
   console.noteln( format( "<end><cbr>[annotate] Solving: RA %.5f Dec %.5f (%s), %.3f\"/px, JD %.2f (%s)",
                           md.ra, md.dec, src, res, md.observationTime, dateSrc ) );

   // A simplified distortion surface with large residuals does not invert
   // cleanly, and AnnotateImage then silently drops catalogue objects (its
   // RA/Dec -> pixel -> RA/Dec check allows 1 px). If that happens, solve
   // once more without the surface simplifier.
   let badSurface = function()
   {
      let m = /Surface residuals[ .]*l:([0-9.]+) px b:([0-9.]+) px/.exec( window.astrometricSolutionSummary() );
      return (m && Math.max( parseFloat( m[1] ), parseFloat( m[2] ) ) > style.seeds.maxSurfaceResidualPx) ? m[1] + "/" + m[2] + " px" : null;
   };

   // A seed taken from the target's catalogue position can be ~0.5 deg off the
   // frame centre (NGC 7000 vs the north-america frame); the default initial
   // alignment then fails, the exhaustive one succeeds.
   try
   {
      solver.solveImage( window );
   }
   catch ( e )
   {
      let msg = (e && e.message) ? e.message : String( e );
      if ( solver.solverCfg.tryExhaustiveInitialAlignment || !/initial field alignment|could not be aligned/.test( msg ) )
         throw e;
      report.solve.retryAlignment = msg + "; solved again with tryExhaustiveInitialAlignment=true";
      console.warningln( "<end><cbr>[annotate] ** " + report.solve.retryAlignment );
      solver.solverCfg.tryExhaustiveInitialAlignment = true;
      solver.solveImage( window );
   }
   if ( !window.hasAstrometricSolution )
      throw new Error( "ImageSolver finished without a solution." );
   let bad = badSurface();
   if ( bad && solver.solverCfg.enableSimplifier )
   {
      report.solve.retry = "surface residuals " + bad + " > " + style.seeds.maxSurfaceResidualPx + " px; solved again with enableSimplifier=false";
      console.warningln( "<end><cbr>[annotate] ** " + report.solve.retry );
      solver.solverCfg.enableSimplifier = false;
      solver.solveImage( window );
      if ( !window.hasAstrometricSolution )
         throw new Error( "ImageSolver finished without a solution." );
      bad = badSurface();
   }
   if ( bad )
      report.solve.warning = "surface residuals " + bad + ": catalogue objects may be missing";
   report.solve.summary = window.astrometricSolutionSummary();
}

// ----------------------------------------------------------------------------
// Annotation engine set-up

function agMakeLayer( ls, id )
{
   let layer = LayerRegistry.newLayer( ls.name );
   if ( layer === null )
      throw new Error( "Unknown AnnotateImage layer: " + ls.name );
   layer.SetId( id );
   layer.visible = false;
   let g = layer.gprops;
   g.showMarkers = ls.showMarkers;
   g.lineColor = agARGB( ls.line );
   g.lineWidth = ls.line.width;
   g.showLabels = ls.label.show;
   g.labelSize = ls.label.size;
   g.labelBold = ls.label.bold;
   g.labelItalic = ls.label.italic;
   g.labelColor = agARGB( ls.label );
   g.labelFace = ls.label.face;
   g.labelFields = ls.labelFields.map( function( f ) { return f ? f : null; } );
   if ( ls.density !== undefined ) layer.density = ls.density;
   if ( ls.margin !== undefined ) layer.margin = ls.margin;
   if ( layer.catalog )
   {
      layer.maxObjects = -1;
      for ( let k in (ls.catalog || {}) )
         layer.catalog[k] = ls.catalog[k];
   }
   layer.agStyle = ls;
   return layer;
}

function agMakeEngine( window, style, report )
{
   let engine = new AnnotationEngine;   // defaults only; Init() is not used because it reads Settings
   for ( let k in style.engine )
      engine[k] = style.engine[k];
   engine.window = window;
   engine.metadata = new AstrometricMetadata( undefined, 1.0 );
   engine.metadata.ExtractMetadata( window );
   if ( engine.metadata.ref_I_G === null )
      throw new Error( "The image has no valid astrometric solution." );

   engine.observationTime = engine.metadata.observationTime ? engine.metadata.observationTime : 2451545.0;
   engine.topocentric = false;
   engine.obsLongitude = engine.obsLatitude = engine.obsHeight = 0;
   engine.synchronizeMetadata();

   // Local catalogues (NamedStars, Messier, NGC-IC) keep an object only if
   // RA/Dec -> pixel -> RA/Dec returns within 1 px. The forward and inverse
   // distortion splines are fitted separately with ~0.7 px residuals each, so
   // objects well inside the frame were dropped at random between two solves
   // of the same image (8 phi Oph on cosmic-bat). Use roundTripTolerancePx
   // instead; it still rejects the far-extrapolation false inclusions the
   // check exists for.
   let tol = style.selection.roundTripTolerancePx*engine.metadata.resolution;
   engine.metadata.insideImageBoundaries = function( posRD )
   {
      let pI = this.Convert_RD_I( posRD, true );
      if ( !pI || pI.x < 0 || pI.y < 0 || pI.x >= this.width || pI.y >= this.height )
         return false;
      let q = this.Convert_I_RD( pI, true );
      if ( !q )
         return false;
      let dx = q.x - posRD.x;
      if ( dx > 180 ) dx -= 360; else if ( dx < -180 ) dx += 360;
      return Math.abs( dx*Math.cos( posRD.y*Math.PI/180 ) ) <= tol && Math.abs( q.y - posRD.y ) <= tol;
   };

   let w = window.mainView.image.width;
   let r = Math.pow( 10, style.sizing.round );
   engine.graphicsScale = Math.round( w/style.sizing.referenceWidth*r )/r;
   engine.textScale = style.sizing.textScale;
   report.sizing = { width: w, height: window.mainView.image.height,
                     graphicsScale: engine.graphicsScale, textScale: engine.textScale };

   engine.layers = style.layers.map( agMakeLayer );
   return engine;
}

function agProminence( sortBy )
{
   let byName = function( a, b ) { return (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0); };
   if ( sortBy == "magnitude" )
      return function( a, b )
      {
         let ma = (a.magnitude === undefined || isNaN( a.magnitude )) ? 99 : a.magnitude;
         let mb = (b.magnitude === undefined || isNaN( b.magnitude )) ? 99 : b.magnitude;
         if ( ma != mb ) return ma - mb;
         if ( a.diameter != b.diameter ) return b.diameter - a.diameter;
         return byName( a, b );
      };
   return function( a, b )
   {
      if ( a.diameter != b.diameter ) return b.diameter - a.diameter;
      return byName( a, b );
   };
}

const agComponentArcsec = 60;

// agSeparationArcsec is the angle between two (RA, Dec) points in degrees.
function agSeparationArcsec( a, b )
{
   let r = Math.PI/180;
   let c = Math.sin( a.y*r )*Math.sin( b.y*r ) + Math.cos( a.y*r )*Math.cos( b.y*r )*Math.cos( (a.x - b.x)*r );
   return Math.acos( Math.min( 1, Math.max( -1, c ) ) )/r*3600;
}

// Loads the given layer set, keeps in-frame objects, removes cross-layer
// duplicates (earlier layer wins), then keeps the most prominent `caps[name]`
// objects per layer. Returns per-layer counts.
function agEvaluate( engine, selected, caps )
{
   let md = engine.metadata;
   let W = md.width, H = md.height;
   for ( let l of engine.layers )
      l.visible = selected.indexOf( l.layerName ) >= 0;

   for ( let l of engine.layers )
      if ( l.visible && l.catalog )
      {
         delete l.Load;   // restore the class method if an earlier pass froze it
         try
         {
            l.Load( md, engine.vizierServer );
         }
         catch ( e )
         {
            console.warningln( "<end><cbr>[annotate] ", l.layerName, ": load failed: ", e.message ?? e );
            l.objects = [];
         }
         if ( !l.objects )
            l.objects = [];
         // Objects smaller than minDiameterPx (catalogue size in image pixels)
         // are not labelled: they are not visible at gallery scale.
         let minDiam = (l.agStyle.minDiameterPx || 0)*md.resolution;
         for ( let i = 0; i < l.objects.length; ++i )
         {
            let o = l.objects[i];
            if ( !o ) continue;
            let p = md.Convert_RD_I( o.posRD );
            if ( p === null || p.x < 0 || p.y < 0 || p.x >= W || p.y >= H || (o.diameter || 0) < minDiam )
               l.objects[i] = null;
         }
      }

   engine.RemoveDuplicates();

   let res = { count: 0, layers: {}, principal: null };
   for ( let l of engine.layers )
      if ( l.visible && l.catalog )
      {
         let objs = l.objects.filter( function( o ) { return o != null; } );
         if ( l.layerName == "Messier" || l.layerName == "NGC-IC" )
            for ( let o of objs )
               if ( res.principal === null || o.diameter > res.principal.diameter )
                  res.principal = { name: o.name, diameter: o.diameter, galaxy: !!o["PGC"] };
         objs.sort( agProminence( l.agStyle.sortBy ) );
         // Components of a multiple star (ζ Ori A and B) are separate
         // catalogue entries with the same designation: keep the most
         // prominent one within agComponentArcsec.
         if ( l.layerName == "NamedStars" )
            objs = objs.filter( function( o, i )
            {
               for ( let j = 0; j < i; ++j )
                  if ( agSeparationArcsec( o.posRD, objs[j].posRD ) < agComponentArcsec )
                     return false;
               return true;
            } );
         let total = objs.length;
         let cap = caps[l.layerName];
         if ( cap !== undefined && objs.length > cap )
            objs = objs.slice( 0, cap );
         l.objects = objs;
         let info = { kept: objs.length, inFrame: total };
         if ( objs.length < total && objs.length > 0 )
         {
            let last = objs[objs.length-1];
            if ( l.agStyle.sortBy == "magnitude" && last.magnitude !== undefined )
               info.limit = format( "mag <= %.2f", last.magnitude );
            else
               info.limit = format( "diameter >= %.2f'", last.diameter*60 );
         }
         res.layers[l.layerName] = info;
         res.count += objs.length;
      }
   return res;
}

// Deterministic layer selection (README "Layer rules").
function agSelectLayers( engine, style, ov, report )
{
   let sel = style.selection;
   let minLabels = ov.minLabels ?? sel.minLabels;
   let targetLabels = ov.targetLabels ?? sel.targetLabels;
   let maxPerLayer = ov.maxPerLayer ?? sel.maxPerLayer;
   let layerMax = ov.layerMax || {};
   let removed = ov.removeLayers || [];
   let capFor = function( name, c ) { return (layerMax[name] !== undefined) ? layerMax[name] : c; };

   let selected = [], caps = {};
   for ( let ls of style.layers )
      if ( ls.role == "core" && removed.indexOf( ls.name ) < 0 )
      {
         selected.push( ls.name );
         caps[ls.name] = capFor( ls.name, maxPerLayer );
      }
   for ( let name of (ov.addLayers || []) )
      if ( selected.indexOf( name ) < 0 )
      {
         selected.push( name );
         caps[name] = capFor( name, maxPerLayer );
      }

   let ev = agEvaluate( engine, selected, caps );
   let n = ev.count;

   let b = agGalacticLatitude( engine.metadata.ra, engine.metadata.dec );
   let fieldType = ov.fieldType;
   let why;
   if ( fieldType )
      why = "override";
   else if ( ev.principal !== null && ev.principal.galaxy )
   {
      fieldType = "galaxy";
      why = "principal object " + ev.principal.name + " is a galaxy";
   }
   else
   {
      fieldType = (Math.abs( b ) < sel.galacticLatitudeSplit) ? "milkyway" : "galaxy";
      why = format( "|b| = %.1f deg %s %d", Math.abs( b ), (fieldType == "milkyway") ? "<" : ">=", sel.galacticLatitudeSplit );
      if ( ev.principal !== null )
         why = "principal object " + ev.principal.name + " is not a galaxy; " + why;
   }

   let steps = [ { stage: "core", labels: n } ];
   for ( let name of sel.priority[fieldType] )
   {
      if ( n >= minLabels )
         break;
      if ( selected.indexOf( name ) >= 0 || removed.indexOf( name ) >= 0 )
         continue;
      let cap = Math.min( capFor( name, maxPerLayer ), targetLabels - n );
      let trialCaps = Object.assign( {}, caps );
      trialCaps[name] = cap;
      let trial = agEvaluate( engine, selected.concat( [name] ), trialCaps );
      let got = trial.layers[name] ? trial.layers[name].kept : 0;
      steps.push( { stage: name, cap: cap, added: got, labels: got > 0 ? trial.count : n } );
      if ( got > 0 )
      {
         selected.push( name );
         caps[name] = cap;
         n = trial.count;
      }
   }

   // Final pass leaves the chosen objects loaded; freeze them so Render()
   // does not reload the full catalogues.
   ev = agEvaluate( engine, selected, caps );
   for ( let l of engine.layers )
      if ( l.visible && l.catalog )
         l.Load = function() {};

   report.selection = { fieldType: fieldType, fieldTypeReason: why, galacticLatitude: b,
                        minLabels: minLabels, targetLabels: targetLabels, maxPerLayer: maxPerLayer,
                        layers: selected, perLayer: ev.layers, labelledObjects: ev.count, steps: steps };
}

// ----------------------------------------------------------------------------
// Entry point
//
// opts: { image: path | view: id, svg: output path,
//         style: path (default: style.json next to this script),
//         overrides: path (default: <image dir>/<name>.annotate.json if present),
//         resolve: bool, ra, dec (deg), resolution ("/px), date, target,
//         report: optional JSON report path, keepOpen: bool, prefix: "ann_" }
function agAnnotate( opts )
{
   let report = { script: "astro.garden annotate " + AG_VERSION, ok: false };
   let window = null, opened = false;
   try
   {
      let style = agReadJSON( opts.style || (AG_SCRIPT_DIR + "/style.json") );

      if ( opts.view )
      {
         window = ImageWindow.windowById( opts.view );
         if ( window.isNull )
            throw new Error( "No such view: " + opts.view );
      }
      else
      {
         let ws = ImageWindow.open( opts.image );
         if ( ws.length == 0 || ws[0].isNull )
            throw new Error( "Cannot open " + opts.image );
         for ( let i = 1; i < ws.length; ++i )
            ws[i].forceClose();
         window = ws[0];
         opened = true;
         window.mainView.id = agUniqueId( (opts.prefix || "ann_") + File.extractName( opts.image ) );
      }
      report.view = window.mainView.id;

      let imgPath = opts.image || window.filePath;
      let ovPath = opts.overrides;
      if ( !ovPath && imgPath )
         ovPath = File.extractDrive( imgPath ) + File.extractDirectory( imgPath ) + '/' + File.extractName( imgPath ) + ".annotate.json";
      let ov = (ovPath && File.exists( ovPath )) ? agReadJSON( ovPath ) : {};
      report.overrides = (ovPath && File.exists( ovPath )) ? ovPath : null;

      if ( opts.resolve || ov.resolve || !window.hasAstrometricSolution )
      {
         let seed = {};
         for ( let k of [ "ra", "dec", "resolution", "date", "target", "solver" ] )
            seed[k] = (opts[k] !== undefined) ? opts[k] : ov[k];
         agSolve( window, style, seed, report );
      }
      else
         report.solve = "existing solution used";

      let engine = agMakeEngine( window, style, report );
      agSelectLayers( engine, style, ov, report );

      engine.outputMode = AnnotationEngine.OutputMode.SVG;
      engine.svgPath = opts.svg;
      engine.writeObjects = false;
      engine.Render();

      let svg = File.readTextFile( opts.svg );
      report.svg = opts.svg;
      report.svgTextElements = (svg.match( /<text/g ) || []).length;
      report.ok = true;
   }
   catch ( e )
   {
      report.error = (e && e.message) ? e.message : String( e );
      console.criticalln( "<end><cbr>[annotate] *** " + report.error );
   }
   finally
   {
      if ( opened && window && !window.isNull && !opts.keepOpen )
         window.forceClose();
   }
   if ( opts.report )
      File.writeTextFile( opts.report, JSON.stringify( report, null, 1 ) );
   return report;
}

// ----------------------------------------------------------------------------
// GUI entry: annotate the active image.

function agGuiMain()
{
   let window = ImageWindow.activeWindow;
   if ( window.isNull )
   {
      (new MessageBox( "Open the finished image first; this script annotates the active image.",
                       "astro.garden annotate", StdIcon.Error, StdButton.Ok )).execute();
      return;
   }
   let fp = window.filePath;
   let sfd = new SaveFileDialog;
   sfd.caption = "Save SVG overlay";
   sfd.filters = [ [ "SVG files", "*.svg" ] ];
   sfd.initialPath = fp ? (File.extractDrive( fp ) + File.extractDirectory( fp ) + '/' + File.extractName( fp ) + "_annotated.svg")
                        : (window.mainView.id + "_annotated.svg");
   if ( !sfd.execute() )
      return;
   let resolve = false;
   if ( window.hasAstrometricSolution )
      resolve = (new MessageBox( "The image already has an astrometric solution. Solve it again?",
                                 "astro.garden annotate", StdIcon.Question, StdButton.No, StdButton.Yes )).execute() == StdButton.Yes;
   console.show();
   let r = agAnnotate( { view: window.mainView.id, svg: sfd.filePath, resolve: resolve } );
   console.writeln( "<end><cbr><raw>" + JSON.stringify( r, null, 1 ) + "</raw>" );
   if ( !r.ok )
      (new MessageBox( r.error, "astro.garden annotate", StdIcon.Error, StdButton.Ok )).execute();
}

if ( typeof AG_HEADLESS == "undefined" )
   agGuiMain();
