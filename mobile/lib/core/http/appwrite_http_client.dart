import 'package:http/http.dart' as http;

import 'appwrite_http_client_stub.dart'
    if (dart.library.html) 'appwrite_http_client_web.dart' as platform;

http.Client createAppwriteHttpClient() => platform.createAppwriteHttpClient();
