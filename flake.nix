{
  description = "Imposter Zero – generic card game engine with OpenSpiel training";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        python = pkgs.python312;
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            pnpm

            python
            python.pkgs.pip
            python.pkgs.virtualenv

            git
            jq
          ];

          shellHook = ''
            echo "imposter-zero dev shell"
            echo "  node $(node --version)"
            echo "  pnpm $(pnpm --version)"
            echo "  python $(python3 --version 2>&1 | cut -d' ' -f2)"
          '';
        };
      }
    );
}
