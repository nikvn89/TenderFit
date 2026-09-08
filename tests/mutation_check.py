#!/usr/bin/env python3
"""
Mutation check — does the Direct Mode suite actually have teeth?

A suite that passes proves nothing on its own; it has to be shown to fail when
the contract is wrong. This makes 20 small, targeted edits to
`contracts/TenderFit.py` — each a plausible mistake that breaks a property the
suite claims to protect — and runs the whole suite against each mutant on real
GenVM.

  KILLED    at least one test failed. The property is genuinely defended.
  SURVIVED  every test still passed. That mutant is an untested gap.

Nothing under `contracts/` is modified: each mutant is written to a temporary
directory and the suite is pointed at it through TENDERFIT_CONTRACT.

    python3 tests/mutation_check.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONTRACT = os.path.join(ROOT, "contracts", "TenderFit.py")
TESTS = os.path.join(ROOT, "tests")

MUTANTS = [
    ("M01", "a supplier may attest for itself",
     '        if supplier_address == attester:\n            raise gl.vm.UserError(\n                "Self-attestation is not accepted"\n            )',
     '        if False:\n            raise gl.vm.UserError(\n                "Self-attestation is not accepted"\n            )'),
    ("M02", "the buyer may list itself as an accepted attester",
     '                if attester_address == gl.message.sender_address:\n                    raise gl.vm.UserError(\n                        "Buyer cannot be an accepted attester"\n                    )',
     '                if False:\n                    raise gl.vm.UserError(\n                        "Buyer cannot be an accepted attester"\n                    )'),
    ("M03", "a revoked attestation still opens the bid gate",
     "                    if not record.revoked:",
     "                    if True:"),
    ("M04", "a missing attestation no longer blocks the bid",
     '            if not matched:\n                raise gl.vm.UserError(\n                    f"Missing accepted attestation for requirement \'{req_key}\'"\n                )',
     '            if False:\n                raise gl.vm.UserError("unreachable")'),
    ("M05", "an empty attestation statement is accepted",
     '            raise gl.vm.UserError("Invalid statement")',
     '            pass'),
    ("M06", "an attestation may be revoked twice",
     "        if record.revoked:\n            raise gl.vm.UserError(\"Attestation already revoked\")",
     "        if False:\n            raise gl.vm.UserError(\"Attestation already revoked\")"),
    ("M07", "bidding continues after the deadline",
     '        if now >= int(procurement.bidding_deadline):\n            raise gl.vm.UserError(\n                "Bidding deadline has passed"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M08", "the buyer may bid on its own procurement",
     '        if sender == procurement.buyer:\n            raise gl.vm.UserError(\n                "Buyer cannot bid on own procurement"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M09", "a bid over the budget is accepted",
     '        if price > int(procurement.max_budget):\n            raise gl.vm.UserError(\n                "Bid price exceeds max_budget"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M10", "a non-positive bid price is accepted",
     '        if price <= 0:\n            raise gl.vm.UserError(\n                "Bid price must be positive"\n            )',
     '        if price < 0:\n            raise gl.vm.UserError(\n                "Bid price must be positive"\n            )'),
    ("M11", "one supplier may bid many times on one procurement",
     '        if self.bidder_submitted.get(\n            bidder_key,\n            False,\n        ):\n            raise gl.vm.UserError(\n                "Bidder already submitted for this procurement"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M12", "an empty proposal is accepted",
     '        if len(proposal) == 0:\n            raise gl.vm.UserError(\n                "proposal_text is required"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M13", "a procurement may be created with a deadline in the past",
     '        if bidding_deadline <= now:\n            raise gl.vm.UserError(\n                "bidding_deadline must be in the future"\n            )',
     '        if bidding_deadline <= 0:\n            raise gl.vm.UserError(\n                "bidding_deadline must be in the future"\n            )'),
    ("M14", "a non-positive budget is accepted",
     '        if max_budget <= 0:\n            raise gl.vm.UserError(\n                "max_budget must be positive"\n            )',
     '        if max_budget < 0:\n            raise gl.vm.UserError(\n                "max_budget must be positive"\n            )'),
    ("M15", "a blank title is accepted",
     '        if len(title) == 0:\n            raise gl.vm.UserError("Title is required")',
     '        if False:\n            raise gl.vm.UserError("Title is required")'),
    ("M16", "finalization runs before the deadline",
     '        if now < int(procurement.bidding_deadline):\n            raise gl.vm.UserError(\n                "Bidding deadline has not passed"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M17", "a procurement may be finalized twice",
     '        if procurement.status != STATUS_OPEN:\n            raise gl.vm.UserError(\n                "Procurement already finalized"\n            )',
     '        if False:\n            raise gl.vm.UserError("unreachable")'),
    ("M18", "an unqualified bid can win the award",
     "            if not bid.qualified:\n                continue",
     "            if False:\n                continue"),
    ("M19", "the highest price wins instead of the lowest",
     "                or bid_price < winner_price",
     "                or bid_price > winner_price"),
    ("M20", "the validator agrees with any leader verdict",
     "            return validator_value == leader_value",
     "            return True"),
]


def run_suite(contract_path):
    env = dict(os.environ, TENDERFIT_CONTRACT=contract_path)
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", TESTS, "-q", "-p", "no:cacheprovider"],
        cwd=ROOT, env=env, capture_output=True, text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main():
    source = open(CONTRACT, encoding="utf-8").read()

    code, output = run_suite(CONTRACT)
    if code != 0:
        print("Baseline suite is already failing; fix that first.\n")
        print(output[-2500:])
        return 1
    print("baseline            PASS\n")

    workdir = tempfile.mkdtemp(prefix="tenderfit-mutants-")
    killed, survived, invalid = [], [], []

    try:
        for mutant_id, description, old, new in MUTANTS:
            if source.count(old) != 1:
                invalid.append((mutant_id, description))
                print(f"{mutant_id}  INVALID   pattern matched "
                      f"{source.count(old)} times -- {description}")
                continue

            path = os.path.join(workdir, f"{mutant_id}.py")
            with open(path, "w", encoding="utf-8") as handle:
                handle.write(source.replace(old, new))

            code, _ = run_suite(path)
            if code == 0:
                survived.append((mutant_id, description))
                print(f"{mutant_id}  SURVIVED  {description}")
            else:
                killed.append((mutant_id, description))
                print(f"{mutant_id}  killed    {description}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    print(f"\n{len(killed)}/{len(MUTANTS)} killed, {len(survived)} survived, "
          f"{len(invalid)} invalid")

    if survived:
        print("\nUntested gaps:")
        for mutant_id, description in survived:
            print(f"  {mutant_id}  {description}")

    return 0 if not survived and not invalid else 1


if __name__ == "__main__":
    sys.exit(main())
