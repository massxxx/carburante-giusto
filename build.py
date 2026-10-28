css=open('leaflet.min.css',encoding='utf-8').read()+'\n'+open('stile.css',encoding='utf-8').read()+'\n:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}\nbody{margin:0}\n'
out='''<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Carburante Giusto</title>
<meta name="description" content="Prezzi ufficiali dei distributori italiani (MIMIT) e il più conveniente per il tuo veicolo">
<meta name="theme-color" content="#13201b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Carburante">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icone/icona-192.png">
<link rel="apple-touch-icon" href="icone/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:wght@400;600&display=swap">
<style>'''+css+'''</style>
</head>
<body>
'''+open('body.html',encoding='utf-8').read()+'''<script src="leaflet.js"></script>
<script>'''+open('app.js',encoding='utf-8').read()+'''</script>
</body>
</html>
'''
open('index.html','w',encoding='utf-8').write(out); print(len(out))
