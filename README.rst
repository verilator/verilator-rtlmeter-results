Verilator RTLMeter results
==========================

This repository contains the RTLMeter benchmark results and dashboard for
Verilator.

The dashboard is published here:

https://verilator.github.io/verilator-rtlmeter-results/

Benchmark results are pushed to the main branch automatically from the
Verilator CI framework.

Developing
==========

If you want to make changes to this repository (the dashboard, or data), you
will need ``npm`` installed, you can then run ``npm run server`` to start the
developer server. You can also use ``npm run watch``, which will start the
developer server and reload it on any code change.

The public pages are deployed automatically from the main branch when pushed
to GitHub.

The actual performance numbers, and additional metadata about the runs are
stored in files under ``src/data``, these are bundled and served as part of
the page. The client fetches these for display. The whole app runs client side.
