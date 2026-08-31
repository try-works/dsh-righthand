# blueprint/paper-digest - run log

## Learnings (arXiv live-probed 2026-08-31)

1. **Keyless and live:** export.arxiv.org/api/query answered 200 with
   Atom XML for search_query=all:agent - no key, no throttle hit.
2. **Atom, not JSON:** entries carry title, summary (the abstract),
   published, authors and the abs link - parse elements, not a body
   object. The files-tools parseListXml is the XML precedent.
3. **One redirect hop:** export.arxiv.org redirects to
   arxiv.org/api - guardedFetch revalidates it like any other hop.
4. **Diff by id:** the arxiv id is the stable key; the next run
   reports only new papers, never re-summarizes the window.

## Cloud test build (2026-08-31)

- Deployed rh-arxiv to workers.dev (keyless, OAuth on the user's own
  account) - the local probe finding (200, no key) now holds from CF
  egress too, including the export -> arxiv redirect hop.
- The Atom parse is the whole worker: no bindings, no state; the
  caller diffs by arxiv id. Template: remote normalize, local
  remember.