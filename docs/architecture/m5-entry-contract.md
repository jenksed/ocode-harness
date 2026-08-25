# M5 entry contract

M4 is complete. M5 begins from the proven governance boundary rather than replacing it.

Any M5 planning or uncertainty-routing work that needs to decide whether a role may take work must translate explicit requirements into `AdmissionRequest` v1: `subject.role`, required semantic capabilities, and requested mutation authority (`edit`, `stage`, `commit`, `push`). It must consume the resulting `AdmissionDecision` and must not infer authority from a role name, model route, OpenCode mode, or permission configuration.

This is an entry contract only. M5 does not yet implement Wayfinder, an `UncertaintyMap`, workflow graphs, TaskSpecs, model routing policy, or a parallel governance engine.
