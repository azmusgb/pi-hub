
    # Initial poll
    time.sleep(1)

    server = HTTPServer(("0.0.0.0", LISTEN_PORT), MetricsHandler)
    logging.info("Listening on http://0.0.0.0:%d/metrics", LISTEN_PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
